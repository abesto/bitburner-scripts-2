import { NS } from "@ns";

import arrayShuffle from "array-shuffle";
import { match } from "variant";
import { Identity } from "variant/lib/util";

import { autonuke } from "/autonuke";
import { DB } from "/database";
import { discoverServers } from "/discoverServers";
import { Log } from "/log";
import * as agg from "/services/Stats/agg";

import { BaseService, HandleRequestResult } from "../common/BaseService";
import { DatabaseClient, dbSync } from "../Database/client";
import { PortRegistryClient } from "../PortRegistry/client";
import { StatsClient } from "../Stats/client";
import { Value } from "../Stats/types";
import { TimerManager } from "../TimerManager";
import {
  Capacity,
  HostAffinity,
  Job,
  JobId,
  jobThreads,
  SERVICE_ID,
  ServiceSpec,
  ServiceStatus,
  TaskId,
} from "./types";
import { SchedulerRequest as Request } from "./types/request";
import { SchedulerResponse as Response } from "./types/response";

function arrayEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export class SchedulerService extends BaseService<typeof Request, Response> {
  private latency: Value[] = [];

  constructor(
    ns: NS,
    private readonly db: DatabaseClient,
    private readonly stats: StatsClient,
    log?: Log
  ) {
    super(ns, log);
    if (this.ns.getHostname() !== "home") {
      throw new Error("SchedulerService must be run on home");
    }
  }

  static async new(ns: NS): Promise<SchedulerService> {
    const log = new Log(ns, "SchedulerService");
    const portRegistry = new PortRegistryClient(ns, log);

    const dbResponsePort = await portRegistry.reservePort();
    const db = new DatabaseClient(ns, log, dbResponsePort);

    const statsResponsePort = await portRegistry.reservePort();
    const stats = new StatsClient(ns, log, statsResponsePort);

    return new SchedulerService(ns, db, stats, log);
  }

  protected override RequestType(): typeof Request {
    return Request;
  }
  protected override serviceId(): typeof SERVICE_ID {
    return SERVICE_ID;
  }
  protected override registerTimers(timers: TimerManager): void {
    // Notice / restart any crashed jobs
    timers.setInterval(() => {
      return this.db.withLock(async (memdb) => {
        let save = this.reviewServices(memdb);
        save = this.reviewJobs(memdb) || save;
        if (save) {
          return memdb;
        }
        return;
      });
    }, 1000);

    timers.setInterval(() => {
      // Report latency
      const latency = this.latency.splice(0, this.latency.length);
      this.stats.record("scheduler.latency.avg", agg.avg(latency));
      this.stats.record("scheduler.latency.p95", agg.p95(latency));

      // Report capacity
      const capacity = this.exploreCapacity();
      const totalMem = capacity.reduce((a, b) => a + b.totalMem, 0);
      const freeMem = capacity.reduce((a, b) => a + b.freeMem, 0);
      this.stats.record("scheduler.capacity.total", totalMem);
      this.stats.record("scheduler.capacity.free", freeMem);
      this.stats.record(
        "scheduler.capacity.usedPct",
        Math.round(((totalMem - freeMem) / totalMem) * 100)
      );
    }, 500);
  }
  protected override async handleRequest(
    request: Identity<Request> | null
  ): Promise<HandleRequestResult> {
    if (request === null) {
      return "continue";
    }
    let result: HandleRequestResult = "continue";
    await match(request, {
      status: (request) => this.status(request),
      capacity: (request) => this.capacity(request),
      exit: async () => {
        result = "exit";
        await this.db.release();
        await this.stats.release();
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
      tailService: (request) => this.tailService(request),
    });
    return result;
  }

  generateJobId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  killChildren(job: JobId, task: TaskId, memdb: DB): void {
    if (parent === undefined) {
      return;
    }
    const allChildren = memdb.scheduler.children;
    if (allChildren === undefined) {
      return;
    }
    const jobChildren = allChildren[job];
    if (jobChildren === undefined) {
      return;
    }
    const taskChildren = jobChildren[task];
    if (taskChildren === undefined) {
      return;
    }
    for (const childJobId of taskChildren) {
      if (childJobId in memdb.scheduler.jobs) {
        this.log.info("Killing child", { job, task, childJobId });
        this.doKillJob(childJobId, memdb);
      }
    }
    delete memdb.scheduler.children[job][task];
    if (Object.keys(memdb.scheduler.children[job]).length === 0) {
      delete memdb.scheduler.children[job];
    }
  }

  tailService(request: Request<"tailService">): void {
    const memdb = dbSync(this.ns, true);

    const service = memdb.scheduler.services[request.serviceName];
    if (service === undefined) {
      return this.respond(
        request.responsePort,
        Response.tailService("not-found")
      );
    }

    const result = match(
      service.status,
      {
        running: (status) => {
          this.ns.tail(status.pid, status.hostname);
          return "ok" as const;
        },
      },
      () => "not-running"
    );
    this.respond(request.responsePort, Response.tailService(result));
  }

  tailTask(request: Request<"tailTask">): void {
    const memdb = dbSync(this.ns, true);
    const job = memdb.scheduler.jobs[request.jobId];
    if (job === undefined) {
      return this.respond(
        request.responsePort,
        Response.tailTask("job-not-found")
      );
    }

    const task = job.tasks[request.taskId];
    if (task === undefined) {
      return this.respond(
        request.responsePort,
        Response.tailTask("task-not-found")
      );
    }

    this.ns.tail(task.pid, task.hostname);
    this.respond(request.responsePort, Response.tailTask("ok"));
  }

  reviewServices(memdb: DB): boolean {
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
            if (this.doStartService(service.spec, memdb) === null) {
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

    return save;
  }

  reviewJobs(memdb: DB): boolean {
    let save = false;
    const jobs = memdb.scheduler.jobs;
    for (const job of Object.values(jobs)) {
      for (const task of Object.values(job.tasks)) {
        const process = this.ns.getRunningScript(task.pid);
        if (process === null) {
          this.log.warn("Task crashed", { job, task });
          this.doTaskFinished(memdb, job.id, task.id, true);
          save = true;
        } else if (
          process.filename !== job.spec.script ||
          arrayEqual(process.args, task.args)
        ) {
          this.log.warn("Task changed script or args", { job, task, process });
          this.doTaskFinished(memdb, job.id, task.id, true);
          save = true;
        }
      }
    }
    return save;
  }

  async startService(request: Request<"startService">): Promise<void> {
    await this.db.withLock(async (memdb) => {
      const service = memdb.scheduler.services[request.serviceName];

      if (service === undefined) {
        this.respond(
          request.responsePort,
          Response.startService({ err: "not-found" })
        );
        return;
      }

      if (service.status.type === "running") {
        this.respond(
          request.responsePort,
          Response.startService({ err: "already-running" })
        );
        return;
      }

      const status = this.doStartService(service.spec, memdb);
      if (status === null) {
        this.respond(
          request.responsePort,
          Response.startService({ err: "failed-to-start" })
        );
        return;
      }

      this.respond(request.responsePort, Response.startService({ ok: status }));
      return memdb;
    });
  }

  protected doStartService(spec: ServiceSpec, memdb: DB): ServiceStatus | null {
    const script = this.serviceScript(spec.name);
    const capacity = this.hostCandidates(
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
    await this.db.withLock(async (memdb) => {
      const service = memdb.scheduler.services[request.serviceName];
      if (service === undefined) {
        this.respond(request.responsePort, Response.stopService("not-found"));
        return;
      }
      const stopResult = this.doStopService(service.spec.name, memdb);
      this.respond(request.responsePort, Response.stopService(stopResult));
      return memdb;
    });
  }

  async enableService(request: Request<"enableService">): Promise<void> {
    await this.db.withLock(async (memdb) => {
      const service = memdb.scheduler.services[request.serviceName];
      if (service === undefined) {
        this.respond(request.responsePort, Response.enableService("not-found"));
        return;
      }
      if (service.enabled) {
        this.respond(
          request.responsePort,
          Response.enableService("already-enabled")
        );
        return;
      }
      service.enabled = true;
      this.respond(request.responsePort, Response.enableService("ok"));
      return memdb;
    });
  }

  async disableService(request: Request<"disableService">): Promise<void> {
    await this.db.withLock(async (memdb) => {
      const service = memdb.scheduler.services[request.serviceName];
      if (service === undefined) {
        this.respond(
          request.responsePort,
          Response.disableService("not-found")
        );
        return;
      }
      if (!service.enabled) {
        this.respond(
          request.responsePort,
          Response.disableService("already-disabled")
        );
        return;
      }
      service.enabled = false;
      this.respond(request.responsePort, Response.disableService("ok"));
      return memdb;
    });
  }

  serviceStatus(request: Request<"serviceStatus">): void {
    const memdb = dbSync(this.ns, true);
    const service = memdb.scheduler.services[request.serviceName];
    this.respond(
      request.responsePort,
      service === undefined
        ? Response.serviceStatus({ err: "not-found" })
        : Response.serviceStatus({
            ok: {
              state: service,
              logs: this.serviceLogs(service.spec.name, memdb),
            },
          })
    );
  }

  serviceLogs(name: string, memdb: DB): string[] {
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
    this.respond(request.responsePort, response);
  }

  protected async doReload(): Promise<Response> {
    const discovered: string[] = [];
    const removed: string[] = [];
    const updated: string[] = [];
    await this.db.withLock(async (memdb) => {
      this.log.info("Reloading services");
      const raw: {
        [name: string]: {
          hostAffinity?: HostAffinity;
          enableWhenDiscovered?: boolean;
        };
      } = JSON.parse(this.ns.read("bin/services/specs.json.txt"));

      for (const name of Object.keys(memdb.scheduler.services)) {
        if (raw[name] === undefined) {
          removed.push(name);
          this.doStopService(name, memdb);
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
            this.doStartService({ name, ...spec }, memdb);
          }
        } else {
          if (
            JSON.stringify(memdb.scheduler.services[name].spec) !==
            JSON.stringify(newSpec)
          ) {
            updated.push(name);
            this.log.info("Updated service", { service: name });
            memdb.scheduler.services[name].spec = newSpec;
            this.doStopService(name, memdb);
            this.doStartService(newSpec, memdb);
          }
        }
      }

      if (discovered.length > 0 || removed.length > 0 || updated.length > 0) {
        return memdb;
      } else {
        return;
      }
    });
    return Response.reload({ discovered, removed, updated });
  }

  protected serviceScript(name: string): string {
    return `bin/services/${name}.js`;
  }

  protected doStopService(
    name: string,
    memdb: DB
  ): "not-found" | "not-running" | "kill-failed" | "ok" {
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

  capacity(request: Request<"capacity">): void {
    const capacity = this.exploreCapacity();
    this.respond(request.responsePort, Response.capacity({ capacity }));
  }

  async status(request: Request<"status">): Promise<void> {
    const memdb = dbSync(this.ns, true);
    const jobs = memdb.scheduler.jobs;
    const services = memdb.scheduler.services;
    this.respond(
      request.responsePort,
      Response.status({
        jobs: Object.values(jobs),
        services: Object.values(services),
      })
    );
  }

  async killAll(): Promise<void> {
    await this.db.withLock(async (memdb) => {
      const jobs = memdb.scheduler.jobs;
      for (const job of Object.values(jobs)) {
        this.doKillJob(job.id, memdb);
      }
      return memdb;
    });
  }

  async killJob(request: Request<"killJob">): Promise<void> {
    let result: "ok" | "not-found" = "not-found";
    await this.db.withLock(async (memdb) => {
      result = this.doKillJob(request.jobId, memdb);
      return memdb;
    });
    this.respond(request.responsePort, Response.killJob({ result }));
  }

  private doKillJob(jobId: JobId, memdb: DB): "ok" | "not-found" {
    let retval: "ok" | "not-found" = "ok";
    const log = this.log.scope("doKillJob");
    const job = memdb.scheduler.jobs[jobId];

    if (job === undefined) {
      log.terror("Could not find job", { jobId });
      retval = "not-found";
    } else if (job.id !== jobId) {
      log.terror("Job ID mismatch", { jobId, onObject: job.id });
    } else {
      for (const task of Object.values(job.tasks)) {
        this.ns.kill(task.pid);
        log.info("Killed task", {
          job: job.id,
          task: task.id,
          hostname: task.hostname,
          pid: task.pid,
        });
        this.killChildren(jobId, task.id, memdb);
      }
      delete memdb.scheduler.jobs[jobId];
      if (memdb) {
        log.info("Killed job", {
          jobId,
          script: job.spec.script,
          args: job.spec.args,
        });
      }
    }

    return retval;
  }

  async taskFinished(request: Request<"taskFinished">): Promise<void> {
    const { jobId, taskId, crash } = request;
    await this.db.withLock(async (memdb) =>
      this.doTaskFinished(memdb, jobId, taskId, crash)
    );
  }

  doTaskFinished(
    memdb: DB,
    jobId: JobId,
    taskId: TaskId,
    crash: boolean
  ): DB | undefined {
    const log = this.log.scope(crash ? "taskCrashed" : "taskFinished");
    this.killChildren(jobId, taskId, memdb);
    const job = memdb.scheduler.jobs[jobId];
    if (job === undefined) {
      if (!crash) {
        log.warn("Could not find job", { jobId });
      }
      return;
    }
    if (job.id !== jobId) {
      log.terror("Job ID mismatch", { jobId, onObject: job.id });
      return;
    }

    const task = job.tasks[taskId];
    if (task === undefined) {
      if (!crash) {
        log.twarn("Could not find task", { jobId, taskId });
      }
      return;
    }
    if (task.id !== taskId) {
      log.terror("Task ID mismatch", { taskId, onObject: task.id });
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
        this.respond(
          finishNotificationPort,
          Response.jobFinished({ jobId: job.id })
        );
      }
    }
    return memdb;
  }

  protected hostCandidates(
    hostAffinity: HostAffinity | undefined,
    scriptRam: number,
    threads: number
  ): Capacity[] {
    this.log.debug("Exploring capacity", { hostAffinity, scriptRam, threads });
    let capacity = this.exploreCapacity();
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
    this.log.debug("Host candidates before host affinity", { capacity });
    // Apply host affinity
    capacity = this.applyHostAffinity(capacity, hostAffinity);
    this.log.debug("Host candidates after host affinity", { capacity });
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
    const capacity = this.hostCandidates(spec.hostAffinity, scriptRam, threads);
    this.log.debug("Capacity chunks", { capacity });

    if (capacity.length === 0) {
      this.log.terror("No hosts available", { script, args, threads });
      if (
        spec.hostAffinity !== undefined &&
        spec.hostAffinity.type === "mustRunOn"
      ) {
        this.log.terror(
          "Hint: job was configured with strict host affinity",
          spec.hostAffinity
        );
      }
    }

    for (const { hostname, freeMem, cores } of capacity) {
      this.log.debug("Trying to schedule on host", {
        hostname,
        freeMem,
        cores,
      });
      if (jobThreads(job) >= threads) {
        this.log.debug("Job already fully scheduled");
        break;
      }
      const availableThreads = Math.max(0, Math.floor(freeMem / scriptRam));
      if (availableThreads < 1) {
        this.log.debug("Host doesn't have enough memory", { hostname });
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
      this.log.debug("Started task", {
        job: job.id,
        task: taskId,
        hostname,
        script,
        argsThisHost,
        pid,
        threads: threadsThisHost,
        cores,
        remaining: threads - jobThreads(job),
      });
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
      await this.db.withLock(async (memdb) => {
        memdb.scheduler.jobs[job.id] = job;
        if (spec.parent !== undefined) {
          if (memdb.scheduler.children === undefined) {
            memdb.scheduler.children = {};
          }
          const allChildren = memdb.scheduler.children;
          if (allChildren[spec.parent.jobId] === undefined) {
            allChildren[spec.parent.jobId] = {};
          }
          const jobChildren = allChildren[spec.parent.jobId];
          if (jobChildren[spec.parent.taskId] === undefined) {
            jobChildren[spec.parent.taskId] = [];
          }
          jobChildren[spec.parent.taskId].push(job.id);
        }
        return memdb;
      });
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
      this.respond(
        request.responsePort,
        Response.start({ jobId: job.id, threads: scheduled })
      );
    }

    if (scheduled === 0 && finishNotificationPort !== null) {
      this.respond(
        finishNotificationPort,
        Response.jobFinished({ jobId: job.id })
      );
    }

    this.latency.push(Date.now() - request.timestamp);

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

  exploreCapacity(): Capacity[] {
    const memdb = dbSync(this.ns, true);
    const hostnames = discoverServers(this.ns);
    const capacities = [];
    for (const hostname of hostnames) {
      const server = this.ns.getServer(hostname);
      if (!autonuke(this.ns, server)) {
        continue;
      }
      const maxRam = server.maxRam;
      let freeMem = maxRam - server.ramUsed;
      if (hostname === "home") {
        freeMem -= memdb.config.scheduler.reserveHomeRam;
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
