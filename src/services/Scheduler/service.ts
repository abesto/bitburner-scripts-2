import { NS } from '@ns';

import { autonuke } from '/autonuke';
import { DB, db, dbLock } from '/database';
import { discoverServers } from '/discoverServers';
import { Fmt } from '/fmt';
import { Log } from '/log';
import { PORTS } from '/ports';
import arrayShuffle from 'array-shuffle';
import deepEqual from 'deep-equal';
import { matchI } from 'ts-adt';
import { ClientPort, ServerPort } from '../common';
import {
    Capacity, capacityResponse, disableServiceResponse, enableServiceResponse, HostAffinity, Job,
    jobFinishedNotification, JobId, jobThreads, killJobResponse, reloadResponse,
    SchedulerRequest$Capacity, SchedulerRequest$DisableService, SchedulerRequest$EnableService,
    SchedulerRequest$KillJob, SchedulerRequest$Reload, SchedulerRequest$ServiceStatus,
    SchedulerRequest$Start, SchedulerRequest$StartService, SchedulerRequest$Status,
    SchedulerRequest$StopService, SchedulerRequest$TaskFinished, SchedulerResponse,
    SERVICE_ID as SCHEDULER, ServiceSpec, ServiceStatus, serviceStatusResponseNotFound,
    serviceStatusResponseOk, startResponse, startServiceResponseAlreadyRunning,
    startServiceResponseFailedToStart, startServiceResponseNotFound, startServiceResponseOk,
    statusResponse, stopServiceResponse, toSchedulerRequest
} from './types';

export class SchedulerService {
  private readonly fmt: Fmt;
  private readonly log: Log;

  constructor(private readonly ns: NS) {
    if (this.ns.getHostname() !== "home") {
      throw new Error("SchedulerService must be run on home");
    }
    this.fmt = new Fmt(ns);
    this.log = new Log(ns, "Scheduler");
  }

  async listen(): Promise<void> {
    await this.doReload();
    await this.reviewServices();

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
      await matchI(request)({
        status: (request) => this.status(request),
        capacity: (request) => this.capacity(request),
        exit: () => {
          exit = true;
        },

        start: (request) => this.start(request),
        killAll: () => this.killAll(),
        killJob: (request) => this.killJob(request),

        taskFinished: (request) => this.taskFinished(request),

        reload: (request) => this.reload(request),
        serviceStatus: (request) => this.serviceStatus(request),
        startService: (request) => this.startService(request),
        stopService: (request) => this.stopService(request),
        enableService: (request) => this.enableService(request),
        disableService: (request) => this.disableService(request),
      });
    }

    this.log.info("Exiting");
  }

  generateJobId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  async reviewServices(): Promise<void> {
    await dbLock(this.ns, "reviewServices", async (memdb) => {
      const services = memdb.scheduler.services;
      for (const name of Object.keys(services)) {
        const service = services[name];
        if (service.status._type === "running") {
          const pid = service.status.pid;
          const process = this.ns.getRunningScript(pid);
          if (
            process === null ||
            process.filename !== this.serviceScript(name) ||
            process.server !== service.status.hostname
          ) {
            service.status = {
              ...service.status,
              _type: "crashed",
              crashedAt: Date.now(),
            };
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
      return memdb;
    });
  }

  async startService(request: SchedulerRequest$StartService): Promise<void> {
    await dbLock(this.ns, "doStartService", async (memdb) => {
      const service = memdb.scheduler.services[request.serviceName];

      const port = new ClientPort<SchedulerResponse>(
        this.ns,
        this.log,
        request.responsePort
      );
      if (service === undefined) {
        await port.write(startServiceResponseNotFound());
        return;
      }
      if (service.status._type === "running") {
        await port.write(startServiceResponseAlreadyRunning());
        return;
      }
      const status = await this.doStartService(service.spec, memdb);
      if (status === null) {
        await port.write(startServiceResponseFailedToStart());
        return;
      }
      await port.write(startServiceResponseOk(status));
      return memdb;
    });
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
    const status: ServiceStatus = {
      _type: "running",
      pid,
      startedAt: Date.now(),
      hostname,
    };
    memdb.scheduler.services[spec.name].status = status;
    this.log.info("Started service", { service: spec.name, hostname, pid });
    return status;
  }

  async stopService(request: SchedulerRequest$StopService): Promise<void> {
    await dbLock(this.ns, "stopService", async (memdb) => {
      const service = memdb.scheduler.services[request.serviceName];
      const port = new ClientPort<SchedulerResponse>(
        this.ns,
        this.log,
        request.responsePort
      );
      if (service === undefined) {
        await port.write(stopServiceResponse("not-found"));
        return;
      }
      const stopResult = await this.doStopService(service.spec.name, memdb);
      await port.write(stopServiceResponse(stopResult));
      return memdb;
    });
  }

  async enableService(request: SchedulerRequest$EnableService): Promise<void> {
    await dbLock(this.ns, "enableService", async (memdb) => {
      const service = memdb.scheduler.services[request.serviceName];
      const port = new ClientPort<SchedulerResponse>(
        this.ns,
        this.log,
        request.responsePort
      );
      if (service === undefined) {
        await port.write(enableServiceResponse("not-found"));
        return;
      }
      if (service.enabled) {
        await port.write(enableServiceResponse("already-enabled"));
        return;
      }
      service.enabled = true;
      await port.write(enableServiceResponse("ok"));
      return memdb;
    });
  }

  async disableService(
    request: SchedulerRequest$DisableService
  ): Promise<void> {
    await dbLock(this.ns, "disableService", async (memdb) => {
      const service = memdb.scheduler.services[request.serviceName];
      const port = new ClientPort<SchedulerResponse>(
        this.ns,
        this.log,
        request.responsePort
      );
      if (service === undefined) {
        await port.write(disableServiceResponse("not-found"));
        return;
      }
      if (!service.enabled) {
        await port.write(disableServiceResponse("already-disabled"));
        return;
      }
      service.enabled = false;
      await port.write(disableServiceResponse("ok"));
      return memdb;
    });
  }

  async serviceStatus(request: SchedulerRequest$ServiceStatus): Promise<void> {
    const memdb = await db(this.ns);
    const service = memdb.scheduler.services[request.serviceName];
    await new ClientPort<SchedulerResponse>(
      this.ns,
      this.log,
      request.responsePort
    ).write(
      service === undefined
        ? serviceStatusResponseNotFound()
        : serviceStatusResponseOk(
            service,
            await this.serviceLogs(service.spec.name)
          )
    );
  }

  async serviceLogs(name: string): Promise<string[]> {
    const memdb = await db(this.ns);
    const service = memdb.scheduler.services[name];
    if (service === undefined) {
      return [];
    }
    if (service.status._type === "running") {
      return this.ns.getScriptLogs(
        this.serviceScript(service.spec.name),
        service.status.hostname
      );
    } else if (
      service.status._type === "crashed" ||
      service.status._type === "stopped"
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

  async reload(request: SchedulerRequest$Reload): Promise<void> {
    const response = await this.doReload();
    await new ClientPort<SchedulerResponse>(
      this.ns,
      this.log,
      request.responsePort
    ).write(response);
  }

  protected async doReload(): Promise<SchedulerResponse> {
    const discovered: string[] = [];
    const removed: string[] = [];
    const updated: string[] = [];
    await dbLock(this.ns, "reload", async (memdb) => {
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
            status: { _type: "new" },
          };
          if (spec.enableWhenDiscovered !== false) {
            await this.doStartService({ name, ...spec }, memdb);
          }
        } else {
          if (!deepEqual(memdb.scheduler.services[name].spec, newSpec)) {
            updated.push(name);
            this.log.info("Updated service", { service: name });
            memdb.scheduler.services[name].spec = newSpec;
            await this.doStopService(name, memdb);
            await this.doStartService(newSpec, memdb);
          }
        }
      }

      if (discovered.length > 0 || removed.length > 0 || updated.length > 0) {
        return memdb;
      }
      return;
    });
    return reloadResponse({ discovered, removed, updated });
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
    } else if (service.status._type !== "running") {
      return "not-running";
    } else {
      if (
        this.ns.kill(
          this.serviceScript(service.spec.name),
          service.status.hostname
        )
      ) {
        service.status = {
          ...service.status,
          stoppedAt: Date.now(),
          _type: "stopped",
        };
        return "ok";
      } else {
        return "kill-failed";
      }
    }
  }

  async capacity(request: SchedulerRequest$Capacity): Promise<void> {
    const [client, capacity] = await Promise.all([
      new ClientPort<SchedulerResponse>(
        this.ns,
        this.log,
        request.responsePort
      ),
      this.exploreCapacity(),
    ]);
    await client.write(capacityResponse(capacity));
  }

  async status(request: SchedulerRequest$Status): Promise<void> {
    await this.reviewServices();
    const memdb = await db(this.ns);
    const jobs = memdb.scheduler.jobs;
    const services = memdb.scheduler.services;
    await new ClientPort<SchedulerResponse>(
      this.ns,
      this.log,
      request.responsePort
    ).write(statusResponse(Object.values(jobs), Object.values(services)));
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
      this.log,
      request.responsePort
    );
    await client.write(killJobResponse(result));
  }

  private async doKillJob(jobId: JobId): Promise<"ok" | "not-found"> {
    let retval: "ok" | "not-found" = "ok";
    const log = this.log.scope("doKillJob");
    await dbLock(this.ns, "doKillJob", async (memdb) => {
      const job = memdb.scheduler.jobs[jobId];
      if (job === undefined) {
        log.terror("Could not find job", { jobId });
        retval = "not-found";
        return;
      }
      if (job.id !== jobId) {
        log.terror("Job ID mismatch", { jobId, onObject: job.id });
      }

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
      log.info("Killed job", {
        jobId,
        script: job.spec.script,
        args: job.spec.args,
      });
      return memdb;
    });
    return retval;
  }

  async taskFinished(request: SchedulerRequest$TaskFinished): Promise<void> {
    const { jobId, taskId, crash } = request;
    const log = this.log.scope("taskFinished");
    await dbLock(this.ns, "finished", async (memdb) => {
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
          log.twarn("Could not find task", { taskId });
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
          const clientPort = new ClientPort<SchedulerResponse>(
            this.ns,
            this.log,
            finishNotificationPort
          );
          await clientPort.write(jobFinishedNotification(job.id));
        }
      }
      return memdb;
    });
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

  async start(request: SchedulerRequest$Start): Promise<void> {
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
      await dbLock(this.ns, "start", async (memdb) => {
        memdb.scheduler.jobs[job.id] = job;
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
      const responsePort = new ClientPort<SchedulerResponse>(
        this.ns,
        this.log,
        request.responsePort
      );
      await responsePort.write(startResponse(job.id, scheduled));
    }

    if (scheduled === 0 && finishNotificationPort !== null) {
      const clientPort = new ClientPort<SchedulerResponse>(
        this.ns,
        this.log,
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
        freeMem = Math.max(0, freeMem);
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
