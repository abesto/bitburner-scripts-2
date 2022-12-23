import { NS } from "@ns";
import { matchI } from "ts-adt";
import arrayShuffle from "array-shuffle";

import { ClientPort, ServerPort } from "../common";
import {
  Capacity,
  HostAffinity,
  Job,
  jobThreads,
  SchedulerRequest$Start,
  SchedulerResponse,
  SERVICE_ID as SCHEDULER,
  toSchedulerRequest,
  startResponse,
  SchedulerRequest$TaskFinished,
  jobFinishedNotification,
  SchedulerRequest$Status,
  statusResponse,
  JobId,
  SchedulerRequest$KillJob,
  killJobResponse,
  capacityResponse,
  SchedulerRequest$Capacity,
} from "./types";
import { autonuke } from "/autonuke";
import { db, dbLock } from "/database";
import { discoverServers } from "/discoverServers";
import { Fmt } from "/fmt";
import { PORTS } from "/ports";

export class SchedulerService {
  private readonly fmt: Fmt;

  constructor(private readonly ns: NS) {
    this.fmt = new Fmt(ns);
  }

  async listen(): Promise<void> {
    const listenPort = new ServerPort(
      this.ns,
      PORTS[SCHEDULER],
      toSchedulerRequest
    );
    this.ns.print(`SchedulerService listening on port ${PORTS[SCHEDULER]}`);

    let exit = false;
    while (!exit) {
      const request = await listenPort.read();
      if (request === null) {
        continue;
      }
      this.ns.print(
        `SchedulerService received request: ${JSON.stringify(request)}`
      );
      await matchI(request)({
        start: (request) => this.start(request),
        taskFinished: (request) => this.taskFinished(request),
        exit: () => {
          exit = true;
        },
        status: (request) => this.status(request),
        capacity: (request) => this.capacity(request),
        killAll: () => this.killAll(),
        killJob: (request) => this.killJob(request),
      });
    }

    this.ns.print("SchedulerService exiting");
  }

  generateJobId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  async capacity(request: SchedulerRequest$Capacity): Promise<void> {
    const [client, capacity] = await Promise.all([
      new ClientPort<SchedulerResponse>(this.ns, request.responsePort),
      this.exploreCapacity(),
    ]);
    await client.write(capacityResponse(capacity));
  }

  async status(request: SchedulerRequest$Status): Promise<void> {
    const jobs = await (await db(this.ns)).scheduler.jobs;
    await new ClientPort<SchedulerResponse>(
      this.ns,
      request.responsePort
    ).write(statusResponse(Object.values(jobs)));
  }

  async killAll(): Promise<void> {
    const jobs = await (await db(this.ns)).scheduler.jobs;
    for (const job of Object.values(jobs)) {
      await this.doKillJob(job.id);
    }
  }

  async killJob(request: SchedulerRequest$KillJob): Promise<void> {
    const result = await this.doKillJob(request.jobId);
    const client = new ClientPort<SchedulerResponse>(
      this.ns,
      request.responsePort
    );
    await client.write(killJobResponse(result));
  }

  private async doKillJob(jobId: JobId): Promise<"ok" | "not-found"> {
    let retval: "ok" | "not-found" = "ok";
    await dbLock(this.ns, "doKillJob", async (memdb) => {
      const job = memdb.scheduler.jobs[jobId];
      if (job === undefined) {
        this.ns.tprint(`WARN killJob: Could not find job ${jobId}`);
        retval = "not-found";
        return;
      }
      if (job.id !== jobId) {
        this.ns.tprint(`WARN killJob: Job ID mismatch: ${job.id} !== ${jobId}`);
      }

      for (const task of Object.values(job.tasks)) {
        this.ns.kill(task.pid);
        this.ns.print(
          `[job=${job.id}][task=${task.id}] ${task.hostname}:${task.pid} Killed as requested`
        );
      }
      delete memdb.scheduler.jobs[jobId];
      this.ns.print(`[job=${job.id}] Killed as requested`);
      return memdb;
    });
    return retval;
  }

  async taskFinished(request: SchedulerRequest$TaskFinished): Promise<void> {
    const { jobId, taskId } = request;
    await dbLock(this.ns, "finished", async (memdb) => {
      const job = memdb.scheduler.jobs[jobId];
      if (job === undefined) {
        this.ns.tprint(`WARN taskFinished: Could not find job ${jobId}`);
        return;
      }
      if (job.id !== jobId) {
        this.ns.tprint(
          `ERROR taskFinished: Job ID mismatch: ${job.id} !== ${jobId}`
        );
        return;
      }

      const task = job.tasks[taskId];
      if (task === undefined) {
        this.ns.tprint(`WARN taskFinished: Could not find task ${taskId}`);
        return;
      }
      if (task.id !== taskId) {
        this.ns.tprint(
          `ERROR taskFinished: Task ID mismatch: ${task.id} !== ${taskId}`
        );
        return;
      }

      this.ns.print(
        `INFO [job=${job.id}][task=${task.id}] ${task.hostname} finished '${job.spec.script} ${job.spec.args}' with ${task.threads} (PID ${task.pid}})`
      );
      delete job.tasks[taskId];

      if (Object.keys(job.tasks).length === 0) {
        this.ns.print(
          `SUCCESS [job=${job.id}] Finished '${job.spec.script} ${job.spec.args}' with ${job.spec.threads}`
        );
        delete memdb.scheduler.jobs[jobId];

        const { finishNotificationPort } = job;
        if (
          finishNotificationPort !== undefined &&
          finishNotificationPort !== null
        ) {
          const clientPort = new ClientPort<SchedulerResponse>(
            this.ns,
            finishNotificationPort
          );
          await clientPort.write(jobFinishedNotification(job.id));
        }
      }
      return memdb;
    });
  }

  async start(request: SchedulerRequest$Start): Promise<void> {
    const { spec, finishNotificationPort } = request;
    const { script, args, threads } = spec;
    if (!this.ns.fileExists(spec.script, "home")) {
      this.ns.tprint(`ERROR Could not find ${script}`);
      return;
    }

    const job: Job = {
      id: this.generateJobId(),
      spec,
      finishNotificationPort,
      tasks: {},
    };
    const scriptRam = this.ns.getScriptRam(script);
    this.ns.print(
      `INFO [job=${
        job.id
      }] Starting ${script} with args ${args} and threads ${threads} (RAM: ${this.fmt.memory(
        scriptRam
      )})`
    );
    let capacity = await this.exploreCapacity();
    // Only want hosts that have enough memory for at least one thread
    capacity = capacity.filter((c) => c.freeMem >= scriptRam);
    // Shuffle!
    capacity = arrayShuffle(capacity);
    // Prefer those hosts that have enough memory for all threads, and prefer the ones with the least memory between those
    capacity = capacity.sort((a, b) => {
      const aHasEnough = a.freeMem >= scriptRam * threads;
      const bHasEnough = b.freeMem >= scriptRam * threads;
      if (aHasEnough && !bHasEnough) {
        return -1;
      }
      if (!aHasEnough && bHasEnough) {
        return 1;
      }
      return a.freeMem - b.freeMem;
    });
    // Apply host affinity
    capacity = this.applyHostAffinity(capacity, spec.hostAffinity);

    for (const { hostname, freeMem, cores } of capacity) {
      if (jobThreads(job) >= threads) {
        break;
      }
      const availableThreads = Math.max(0, Math.floor(freeMem / scriptRam));
      if (availableThreads < 1) {
        continue;
      }
      if (!this.ns.scp(script, hostname)) {
        this.ns.tprint(
          `WARN [job=${job.id}] Could not copy ${script} to ${hostname}`
        );
        continue;
      }
      const threadsThisHost = Math.min(
        availableThreads,
        threads - jobThreads(job)
      );
      const taskId = Object.keys(job.tasks).length;
      const argsThisHost = [...args, "--job", job.id, "--task", taskId];
      const pid = this.ns.exec(
        script,
        hostname,
        threadsThisHost,
        ...argsThisHost
      );
      if (pid === 0) {
        this.ns.tprint(
          `WARN [job=${
            job.id
          }] Could not start ${script} on ${hostname} (tried ${threadsThisHost} threads). Memory: ${this.fmt.memory(
            freeMem
          )}. Script mem: ${this.fmt.memory(
            scriptRam
          )}. Available threads: ${availableThreads}.`
        );
        continue;
      }
      this.ns.print(
        `INFO [job=${
          job.id
        }] Started ${script} on ${hostname} (PID: ${pid}, threads: ${threadsThisHost}, cores: ${cores}), remaining: ${
          threads - jobThreads(job)
        }`
      );

      job.tasks[taskId] = {
        id: taskId,
        hostname,
        args: argsThisHost.map((a) => a.toString()),
        pid,
        threads: threadsThisHost,
      };
    }

    const scheduled = jobThreads(job);
    if (scheduled > 0) {
      await dbLock(this.ns, "start", async (memdb) => {
        memdb.scheduler.jobs[job.id] = job;
        return memdb;
      });
    }

    if (scheduled < threads) {
      this.ns.print(
        `WARN [job=${job.id}] Could not schedule ${threads} threads, scheduled ${scheduled}`
      );
    } else {
      this.ns.print(`SUCCESS [job=${job.id}] Scheduled ${scheduled} threads`);
    }

    if (request.responsePort !== null) {
      const responsePort = new ClientPort<SchedulerResponse>(
        this.ns,
        request.responsePort
      );
      await responsePort.write(startResponse(job.id, scheduled));
    }

    if (scheduled === 0 && finishNotificationPort !== null) {
      const clientPort = new ClientPort<SchedulerResponse>(
        this.ns,
        finishNotificationPort
      );
      await clientPort.write(jobFinishedNotification(job.id));
    }

    const tasks = Object.values(job.tasks);
    if (tasks.length === 1 && request.tail) {
      this.ns.tail(tasks[0].pid, tasks[0].hostname);
    }
  }

  applyHostAffinity(
    capacities: Capacity[],
    hostAffinity: HostAffinity | undefined
  ): Capacity[] {
    if (hostAffinity === undefined) {
      // No affinity, push home to the back
      const home = capacities.filter((c) => c.hostname === "home");
      const other = capacities.filter((c) => c.hostname !== "home");
      return other.concat(home);
    }
    return matchI(hostAffinity)({
      mustRunOn: ({ host }) => capacities.filter((c) => c.hostname === host),
      preferToRunOn: ({ host }) => {
        const preferred = capacities.filter((c) => c.hostname === host);
        const other = capacities.filter((c) => c.hostname !== host);
        return preferred.concat(other);
      },
    });
  }

  async exploreCapacity(): Promise<Capacity[]> {
    const hostnames = discoverServers(this.ns);
    const capacities = [];
    for (const hostname of hostnames) {
      if (!autonuke(this.ns, hostname)) {
        continue;
      }
      const server = this.ns.getServer(hostname);
      let freeMem = server.maxRam - this.ns.getServerUsedRam(hostname);
      if (hostname === "home") {
        freeMem -= (await db(this.ns)).config.scheduler.reserveHomeRam;
      }
      capacities.push({
        hostname,
        freeMem,
        totalMem: server.maxRam,
        cores: server.cpuCores,
      });
    }
    return capacities;
  }
}
