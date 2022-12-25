import { NS } from '@ns';

import arrayShuffle from 'array-shuffle';
import { match } from 'variant';

import { autonuke } from '/autonuke';
import { DB } from '/database';
import { discoverServers } from '/discoverServers';
import { Fmt } from '/fmt';
import { Log } from '/log';
import { PORTS } from '/ports';

import { ClientPort } from '../common/ClientPort';
import { ServerPort } from '../common/ServerPort';
import { DatabaseClient, db } from '../Database/client';
import { PortRegistryClient } from '../PortRegistry/client';
import {
    Capacity, HostAffinity, Job, JobId, jobThreads, SERVICE_ID as SCHEDULER, ServiceSpec,
    ServiceStatus
} from './types';
import { SchedulerRequest as Request, toSchedulerRequest } from './types/request';
import { SchedulerResponse as Response } from './types/response';

export class SchedulerService {
  private readonly fmt: Fmt;

  constructor(
    private readonly ns: NS,
    private readonly log: Log,
    private readonly portRegistry: PortRegistryClient,
    private readonly dbResponsePort: number,
    private readonly db: DatabaseClient
  ) {
    if (this.ns.getHostname() !== "home") {
      throw new Error("SchedulerService must be run on home");
    }
    this.fmt = new Fmt(ns);
  }

  static async new(ns: NS): Promise<SchedulerService> {
    const log = new Log(ns, "Scheduler");
    const portRegistry = new PortRegistryClient(ns, log);
    const dbResponsePort = await portRegistry.reservePort();
    const db = new DatabaseClient(ns, log, dbResponsePort);
    return new SchedulerService(ns, log, portRegistry, dbResponsePort, db);
  }

  async listen(): Promise<void> {
    await this.reviewServices();
    await this.doReload();

    const listenPort = new ServerPort(
      this.ns,
      this.log,
      PORTS[SCHEDULER],
      toSchedulerRequest
    );
    this.log.info("Listening", {
      port: listenPort.portNumber,
    });

    let exit = false;
    while (!exit) {
      const request = await listenPort.read(null);
      if (request === null) {
        continue;
      }
      this.log.info("Request", { request });
      await match(request, {
        status: (request) => this.status(request),
        capacity: (request) => this.capacity(request),
        exit: () => {
          exit = true;
        },

        start: (request) => this.start(request),
        killAll: () => this.killAll(),
        killJob: (request) => this.killJob(request),
        tailTask: (request) => this.tailTask(request),

        taskFinished: (request) => this.taskFinished(request),

        reload: (request) => this.reload(request),
        serviceStatus: (request) => this.serviceStatus(request),
        startService: (request) => this.startService(request),
        stopService: (request) => this.stopService(request),
        enableService: (request) => this.enableService(request),
        disableService: (request) => this.disableService(request),
      });
    }

    await this.portRegistry.releasePort(this.dbResponsePort);
    this.log.info("Exiting");
  }

  generateJobId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  async tailTask(request: Request<"tailTask">): Promise<void> {
    const memdb = await db(this.ns, this.log, true);
    const port = new ClientPort<Response>(
      this.ns,
      this.log,
      request.responsePort
    );

    const job = memdb.scheduler.jobs[request.jobId];
    if (job === undefined) {
      await port.write(Response.tailTask("job-not-found"));
      return;
    }

    const task = job.tasks[request.taskId];
    if (task === undefined) {
      await port.write(Response.tailTask("task-not-found"));
      return;
    }

    this.ns.tail(task.pid, task.hostname);
    await port.write(Response.tailTask("ok"));
  }

  async reviewServices(): Promise<void> {
    const memdb = await this.db.lock();
    const services = memdb.scheduler.services;
    let save = false;

    for (const name of Object.keys(services)) {
      const service = services[name];
      if (service.status.type === "running") {
        const pid = service.status.pid;
        const process = this.ns.getRunningScript(pid);
        if (
          process === null ||
          process.filename !== this.serviceScript(name) ||
          process.server !== service.status.hostname
        ) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { type, ...status } = service.status;
          service.status = ServiceStatus.crashed({
            crashedAt: Date.now(),
            ...status,
          });
          save = true;
          if (service.enabled) {
            if ((await this.doStartService(service.spec, memdb)) === null) {
              this.log.terror("Service crashed, restart failed", {
                service: name,
              });
            } else {
              this.log.twarn("Service crashed, restart successful", {
                service: name,
              });
            }
          } else {
            this.log.terror(
              "Service crashed, not restarting because it's disabled",
              { service: name }
            );
          }
        }
      }
    }

    if (save) {
      await this.db.writeAndUnlock(memdb);
    } else {
      await this.db.unlock();
    }
  }

  async startService(request: Request<"startService">): Promise<void> {
    const memdb = await this.db.lock();
    const service = memdb.scheduler.services[request.serviceName];

    const port = new ClientPort<Response>(
      this.ns,
      this.log,
      request.responsePort
    );

    if (service === undefined) {
      await port.write(Response.startService({ err: "not-found" }));
      await this.db.unlock();
      return;
    }

    if (service.status.type === "running") {
      await port.write(Response.startService({ err: "already-running" }));
      await this.db.unlock();
      return;
    }

    const status = await this.doStartService(service.spec, memdb);
    if (status === null) {
      await port.write(Response.startService({ err: "failed-to-start" }));
      await this.db.unlock();
      return;
    }

    await port.write(Response.startService({ ok: status }));
    await this.db.writeAndUnlock(memdb);
  }

  protected async doStartService(
    spec: ServiceSpec,
    memdb: DB
  ): Promise<ServiceStatus | null> {
    const script = this.serviceScript(spec.name);
    const capacity = await this.hostCandidates(
      spec.hostAffinity,
      this.ns.getScriptRam(script),
      1
    );
    const hostname = capacity[0]?.hostname;
    if (hostname === undefined) {
      this.log.error("Failed to find host for service", { service: spec.name });
      return null;
    }

    if (hostname !== "home") {
      if (!this.ns.scp(script, hostname)) {
        this.log.error("Failed to copy service to host", {
          script,
          hostname,
          service: spec.name,
        });
        return null;
      }
    }

    const pid = this.ns.exec(script, hostname, 1);
    if (pid === 0) {
      this.log.error("Failed to start service", {
        service: spec.name,
        hostname,
      });
      return null;
    }
    const status = ServiceStatus.running({
      pid,
      startedAt: Date.now(),
      hostname,
    });
    memdb.scheduler.services[spec.name].status = status;
    this.log.info("Started service", { service: spec.name, hostname, pid });
    return status;
  }

  async stopService(request: Request<"stopService">): Promise<void> {
    const memdb = await this.db.lock();
    const service = memdb.scheduler.services[request.serviceName];
    const port = new ClientPort<Response>(
      this.ns,
      this.log,
      request.responsePort
    );
    if (service === undefined) {
      await this.db.unlock();
      await port.write(Response.stopService("not-found"));
      return;
    }
    const stopResult = await this.doStopService(service.spec.name, memdb);
    await port.write(Response.stopService(stopResult));
    await this.db.writeAndUnlock(memdb);
  }

  async enableService(request: Request<"enableService">): Promise<void> {
    const memdb = await this.db.lock();
    const service = memdb.scheduler.services[request.serviceName];
    const port = new ClientPort<Response>(
      this.ns,
      this.log,
      request.responsePort
    );
    if (service === undefined) {
      await this.db.unlock();
      await port.write(Response.enableService("not-found"));
      return;
    }
    if (service.enabled) {
      await this.db.unlock();
      await port.write(Response.enableService("already-enabled"));
      return;
    }
    service.enabled = true;
    await port.write(Response.enableService("ok"));
    await this.db.writeAndUnlock(memdb);
  }

  async disableService(request: Request<"disableService">): Promise<void> {
    const memdb = await this.db.lock();
    const service = memdb.scheduler.services[request.serviceName];
    const port = new ClientPort<Response>(
      this.ns,
      this.log,
      request.responsePort
    );
    if (service === undefined) {
      await this.db.unlock();
      await port.write(Response.disableService("not-found"));
      return;
    }
    if (!service.enabled) {
      await this.db.unlock();
      await port.write(Response.disableService("already-disabled"));
      return;
    }
    service.enabled = false;
    await port.write(Response.disableService("ok"));
    await this.db.writeAndUnlock(memdb);
  }

  async serviceStatus(request: Request<"serviceStatus">): Promise<void> {
    const memdb = await db(this.ns, this.log, true);
    const service = memdb.scheduler.services[request.serviceName];
    await new ClientPort<Response>(
      this.ns,
      this.log,
      request.responsePort
    ).write(
      service === undefined
        ? Response.serviceStatus({ err: "not-found" })
        : Response.serviceStatus({
            ok: {
              state: service,
              logs: await this.serviceLogs(service.spec.name),
            },
          })
    );
  }

  async serviceLogs(name: string): Promise<string[]> {
    const memdb = await db(this.ns, this.log, true);
    const service = memdb.scheduler.services[name];
    if (service === undefined) {
      return [];
    }
    if (service.status.type === "running") {
      return this.ns.getScriptLogs(
        this.serviceScript(service.spec.name),
        service.status.hostname
      );
    } else if (
      service.status.type === "crashed" ||
      service.status.type === "stopped"
    ) {
      const recentScripts = this.ns.getRecentScripts();
      for (const script of recentScripts) {
        if (
          script.pid === service.status.pid &&
          script.filename === this.serviceScript(service.spec.name) &&
          script.server === service.status.hostname
        ) {
          return this.ns.getScriptLogs(script.filename, script.server);
        }
      }
    }
    return [];
  }

  async reload(request: Request<"reload">): Promise<void> {
    const response = await this.doReload();
    await new ClientPort<Response>(
      this.ns,
      this.log,
      request.responsePort
    ).write(response);
  }

  protected async doReload(): Promise<Response> {
    const discovered: string[] = [];
    const removed: string[] = [];
    const updated: string[] = [];
    const memdb = await this.db.lock();
    this.log.info("Reloading services");
    const raw: {
      [name: string]: {
        hostAffinity?: HostAffinity;
        enableWhenDiscovered?: boolean;
      };
    } = JSON.parse(this.ns.read("/bin/services/specs.json.txt"));

    for (const name of Object.keys(memdb.scheduler.services)) {
      if (raw[name] === undefined) {
        removed.push(name);
        await this.doStopService(name, memdb);
        this.log.info("Removed service", { service: name });
      }
    }

    for (const [name, spec] of Object.entries(raw)) {
      const newSpec: ServiceSpec = { name, hostAffinity: spec.hostAffinity };
      if (memdb.scheduler.services[name] === undefined) {
        discovered.push(name);
        this.log.info("Discovered service", { service: name });
        memdb.scheduler.services[name] = {
          spec: newSpec,
          enabled: spec.enableWhenDiscovered !== false,
          status: ServiceStatus.new(),
        };
        if (spec.enableWhenDiscovered !== false) {
          await this.doStartService({ name, ...spec }, memdb);
        }
      } else {
        if (
          JSON.stringify(memdb.scheduler.services[name].spec) !==
          JSON.stringify(newSpec)
        ) {
          updated.push(name);
          this.log.info("Updated service", { service: name });
          memdb.scheduler.services[name].spec = newSpec;
          await this.doStopService(name, memdb);
          await this.doStartService(newSpec, memdb);
        }
      }
    }

    if (discovered.length > 0 || removed.length > 0 || updated.length > 0) {
      await this.db.writeAndUnlock(memdb);
    } else {
      await this.db.unlock();
    }
    return Response.reload({ discovered, removed, updated });
  }

  protected serviceScript(name: string): string {
    return `/bin/services/${name}.js`;
  }

  protected async doStopService(
    name: string,
    memdb: DB
  ): Promise<"not-found" | "not-running" | "kill-failed" | "ok"> {
    const service = memdb.scheduler.services[name];
    if (service === undefined) {
      return "not-found";
    } else if (service.status.type !== "running") {
      return "not-running";
    } else {
      if (
        this.ns.kill(
          this.serviceScript(service.spec.name),
          service.status.hostname
        )
      ) {
        const old = service.status;
        service.status = ServiceStatus.stopped({
          pid: old.pid,
          hostname: old.hostname,
          startedAt: old.startedAt,
          stoppedAt: Date.now(),
        });
        return "ok";
      } else {
        return "kill-failed";
      }
    }
  }

  async capacity(request: Request<"capacity">): Promise<void> {
    const [client, capacity] = await Promise.all([
      new ClientPort<Response>(this.ns, this.log, request.responsePort),
      this.exploreCapacity(),
    ]);
    await client.write(Response.capacity({ capacity }));
  }

  async status(request: Request<"status">): Promise<void> {
    await this.reviewServices();
    const memdb = await db(this.ns, this.log, true);
    const jobs = memdb.scheduler.jobs;
    const services = memdb.scheduler.services;
    await new ClientPort<Response>(
      this.ns,
      this.log,
      request.responsePort
    ).write(
      Response.status({
        jobs: Object.values(jobs),
        services: Object.values(services),
      })
    );
  }

  async killAll(): Promise<void> {
    const jobs = await (await db(this.ns, this.log)).scheduler.jobs;
    for (const job of Object.values(jobs)) {
      await this.doKillJob(job.id);
    }
  }

  async killJob(request: Request<"killJob">): Promise<void> {
    const result = await this.doKillJob(request.jobId);
    const client = new ClientPort<Response>(
      this.ns,
      this.log,
      request.responsePort
    );
    await client.write(Response.killJob({ result }));
  }

  private async doKillJob(jobId: JobId): Promise<"ok" | "not-found"> {
    let retval: "ok" | "not-found" = "ok";
    const log = this.log.scope("doKillJob");
    const memdb = await this.db.lock();
    const job = memdb.scheduler.jobs[jobId];

    if (job === undefined) {
      log.terror("Could not find job", { jobId });
      retval = "not-found";
      await this.db.unlock();
    } else if (job.id !== jobId) {
      log.terror("Job ID mismatch", { jobId, onObject: job.id });
      await this.db.unlock();
    } else {
      for (const task of Object.values(job.tasks)) {
        this.ns.kill(task.pid);
        log.info("Killed task", {
          job: job.id,
          task: task.id,
          hostname: task.hostname,
          pid: task.pid,
        });
      }
      delete memdb.scheduler.jobs[jobId];
      await this.db.writeAndUnlock(memdb);
      log.info("Killed job", {
        jobId,
        script: job.spec.script,
        args: job.spec.args,
      });
    }

    return retval;
  }

  async taskFinished(request: Request<"taskFinished">): Promise<void> {
    const { jobId, taskId, crash } = request;
    const log = this.log.scope("taskFinished");
    const memdb = await this.db.lock();
    const job = memdb.scheduler.jobs[jobId];
    if (job === undefined) {
      if (!crash) {
        log.warn("Could not find job", { jobId });
      }
      await this.db.unlock();
      return;
    }
    if (job.id !== jobId) {
      log.terror("Job ID mismatch", { jobId, onObject: job.id });
      await this.db.unlock();
      return;
    }

    const task = job.tasks[taskId];
    if (task === undefined) {
      if (!crash) {
        log.twarn("Could not find task", { taskId });
      }
      await this.db.unlock();
      return;
    }
    if (task.id !== taskId) {
      log.terror("Task ID mismatch", { taskId, onObject: task.id });
      await this.db.unlock();
      return;
    }

    log.info("Task finished", {
      job: job.id,
      task: task.id,
      hostname: task.hostname,
      pid: task.pid,
      script: job.spec.script,
      args: job.spec.args,
      threads: task.threads,
    });
    delete job.tasks[taskId];

    if (Object.keys(job.tasks).length === 0) {
      log.info("Job finished", {
        job: job.id,
        script: job.spec.script,
        args: job.spec.args,
        threads: job.spec.threads,
      });
      delete memdb.scheduler.jobs[jobId];

      const { finishNotificationPort } = job;
      if (
        finishNotificationPort !== undefined &&
        finishNotificationPort !== null
      ) {
        const clientPort = new ClientPort<Response>(
          this.ns,
          this.log,
          finishNotificationPort
        );
        await clientPort.write(Response.jobFinished({ jobId: job.id }));
      }
    }
    await this.db.writeAndUnlock(memdb);
  }

  protected async hostCandidates(
    hostAffinity: HostAffinity | undefined,
    scriptRam: number,
    threads: number
  ): Promise<Capacity[]> {
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
    capacity = this.applyHostAffinity(capacity, hostAffinity);
    return capacity;
  }

  async start(request: Request<"start">): Promise<void> {
    const { spec, finishNotificationPort } = request;
    const { script, args, threads } = spec;
    if (!this.ns.fileExists(spec.script, "home")) {
      this.log.terror("Could not find script", { script });
      return;
    }

    const job: Job = {
      id: this.generateJobId(),
      spec,
      finishNotificationPort,
      tasks: {},
    };
    const scriptRam = this.ns.getScriptRam(script);
    this.log.info("Starting job", {
      job: job.id,
      script,
      args,
      threads,
      scriptRam: this.fmt.memory(scriptRam),
    });
    const capacity = await this.hostCandidates(
      spec.hostAffinity,
      scriptRam,
      threads
    );

    for (const { hostname, freeMem, cores } of capacity) {
      if (jobThreads(job) >= threads) {
        break;
      }
      const availableThreads = Math.max(0, Math.floor(freeMem / scriptRam));
      if (availableThreads < 1) {
        continue;
      }
      if (!this.ns.scp(script, hostname)) {
        this.log.twarn("Could not copy script to host", { script, hostname });
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
        this.log.twarn("Failed to start task", {
          job: job.id,
          task: taskId,
          hostname,
          script,
          args,
          threads: threadsThisHost,
          scriptRam: this.fmt.memory(scriptRam),
          availableThreads,
        });
        continue;
      }
      this.log.info("Started task", {
        job: job.id,
        task: taskId,
        hostname,
        script,
        args,
        pid,
        threads: threadsThisHost,
        cores,
        remaining: threads - jobThreads(job),
      });

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
      const memdb = await this.db.lock();
      memdb.scheduler.jobs[job.id] = job;
      await this.db.writeAndUnlock(memdb);
    }

    if (scheduled < threads) {
      this.log.warn("Couldn't schedule all threads", {
        job: job.id,
        script,
        args,
        wanted: threads,
        scheduled,
      });
    } else {
      this.log.info("Job scheduled", {
        job: job.id,
        script,
        args,
        threads: scheduled,
      });
    }

    if (request.responsePort !== null) {
      const responsePort = new ClientPort<Response>(
        this.ns,
        this.log,
        request.responsePort
      );
      await responsePort.write(
        Response.start({ jobId: job.id, threads: scheduled })
      );
    }

    if (scheduled === 0 && finishNotificationPort !== null) {
      const clientPort = new ClientPort<Response>(
        this.ns,
        this.log,
        finishNotificationPort
      );
      await clientPort.write(Response.jobFinished({ jobId: job.id }));
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
    return match(hostAffinity, {
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
      const maxRam = this.ns.getServerMaxRam(hostname);
      let freeMem = maxRam - this.ns.getServerUsedRam(hostname);
      if (hostname === "home") {
        freeMem -= (await db(this.ns, this.log, true)).config.scheduler
          .reserveHomeRam;
        freeMem = Math.max(0, freeMem);
      }
      capacities.push({
        hostname,
        freeMem,
        totalMem: maxRam,
        cores: 1, // TODO: Support multi-core servers
      });
    }
    return capacities;
  }
}
