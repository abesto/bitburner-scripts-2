import { NS } from "@ns";

import { matchI } from "ts-adt";
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
        status: (request) => {},
        killJob: (request) => {},
      });
    }
  }

  generateJobId(): string {
    return (
      Math.random().toString(36).substring(2) + "." + Date.now().toString(36)
    );
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
    capacity = this.applyHostAffinity(capacity, spec.hostAffinity);
    // Only want hosts that have enough memory for at least one thread
    capacity = capacity.filter((c) => c.freeMem >= scriptRam);
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

    for (const { hostname, freeMem, cores } of capacity) {
      if (jobThreads(job) >= threads) {
        break;
      }
      const availableThreads = Math.max(
        0,
        Math.floor(
          hostname === "home"
            ? Math.floor(
                (freeMem -
                  (await db(this.ns)).config.supervisor.reserveHomeRam) /
                  scriptRam
              )
            : Math.floor(freeMem / scriptRam)
        )
      );
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
          `WARN [job=${job.id}] Could not start ${script} on ${hostname} (tried ${threadsThisHost} threads)`
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

    await dbLock(this.ns, "start", async (memdb) => {
      memdb.scheduler.jobs[job.id] = job;
      return memdb;
    });

    const scheduled = jobThreads(job);
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

    const tasks = Object.values(job.tasks);
    if (tasks.length === 1 && request.tail) {
      this.ns.tail(tasks[0].pid);
    }
  }

  applyHostAffinity(
    capacities: Capacity[],
    hostAffinity: HostAffinity | undefined
  ): Capacity[] {
    if (hostAffinity === undefined) {
      return capacities;
    }
    return matchI(hostAffinity)({
      mustRunOn: (hostname) =>
        capacities.filter((c) => c.hostname === hostname),
      preferToRunOn: (hostname) => {
        const preferred = capacities.filter((c) => c.hostname === hostname);
        const other = capacities.filter((c) => c.hostname !== hostname);
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
        freeMem -= (await db(this.ns)).config.supervisor.reserveHomeRam;
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
