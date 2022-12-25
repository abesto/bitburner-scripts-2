// CLI to talk to SchedulerService
import { AutocompleteData, NS } from '@ns';

import minimist from 'minimist';
import { match } from 'variant';

import * as serviceSpecs from '/bin/services/specs.json.txt';
import * as colors from '/colors';
import { Fmt } from '/fmt';
import { Log } from '/log';
import { withClient } from '/services/client_factory';
import { NoResponseSchedulerClient, SchedulerClient } from '/services/Scheduler/client';
import { jobThreads, ServiceState, ServiceStatus } from '/services/Scheduler/types';

const SCHEDULER_SCRIPT = "/bin/services/Scheduler.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const log = new Log(ns, "sc");
  const fmt = new Fmt(ns);

  const args = minimist(
    ns.args.map((x) => x.toString()),
    {
      boolean: ["stail", "verbose"],
      string: ["threads"],
      "--": true,
    }
  );

  const posArgs = args._ as string[];
  const command = posArgs[0] as string;

  const commandImpls: { [name: string]: () => Promise<void> } = {
    status,
    capacity,
    "start-daemon": startDaemon,
    "stop-daemon": exit,
    "restart-daemon": restart,
    "tail-daemon": tailDaemon,
    start,
    run,
    "kill-all": killAll,
    "kill-job": killJob,
    "tail-task": tailTask,
    reload,
    services,
    "service-status": serviceStatus,
    "start-service": startService,
    "stop-service": stopService,
    "restart-service": restartService,
    "enable-service": enableService,
    "disable-service": disableService,
  };

  const impl = commandImpls[command];
  if (impl) {
    await impl();
  } else {
    log.terror("Invalid command", { command });
  }

  async function start() {
    const threads = parseInt(args.threads || "1");
    if (threads <= 0) {
      log.terror("Invalid or missing --threads", { threads });
      return;
    }
    await withClient(SchedulerClient, ns, log, async (client) => {
      const response = await client.start(
        {
          threads,
          script: posArgs[1],
          args: args["--"] || [],
        },
        args.stail as boolean,
        null
      );
      log.tinfo("Started job", response);
    });
  }

  async function run() {
    const threads = parseInt(args.threads || "1");
    if (threads <= 0) {
      log.terror("Invalid or missing --threads", { threads });
      return;
    }
    const jobId = await withClient(SchedulerClient, ns, log, async (client) => {
      const response = await client.start(
        {
          threads,
          script: posArgs[1],
          args: args["--"] || [],
        },
        args.stail as boolean
      );
      log.info("Started job", response);
      await client.waitForJobFinished(response.jobId);
      return response.jobId;
    });
    log.info("Job finished", { jobId });
  }

  async function status() {
    const status = await withClient(
      SchedulerClient,
      ns,
      log,
      async (client) => {
        return await client.status();
      }
    );
    for (const job of status.jobs) {
      log.tinfo("Job", {
        jobId: job.id,
        script: job.spec.script,
        args: job.spec.args,
        threads: jobThreads(job),
        requestedThreads: job.spec.threads,
      });
      if (args.verbose as boolean) {
        for (const task of Object.values(job.tasks)) {
          log.tinfo("  Task", {
            taskId: task.id,
            hostname: task.hostname,
            threads: task.threads,
          });
        }
      }
    }
  }

  async function exit() {
    await new NoResponseSchedulerClient(ns, log).exit();
    log.tinfo("Exit request sent");
  }

  async function killAll() {
    await new NoResponseSchedulerClient(ns, log).killAll();
    log.tinfo("Kill-all request sent");
  }

  async function killJob() {
    const jobId = posArgs[1];
    if (!jobId) {
      log.terror("Missing job ID", { jobId });
      return;
    }
    await withClient(SchedulerClient, ns, log, async (client) => {
      const response = (await client.killJob(jobId)).result;
      log.tinfo("Kill request", { jobId, response });
    });
  }

  async function tailTask() {
    const jobId = posArgs[1];
    const taskId = parseInt(posArgs[2] || "0");
    if (!jobId) {
      log.terror("Missing job ID", { jobId });
      return;
    }
    await withClient(SchedulerClient, ns, log, async (client) => {
      const response = await client.tailTask(jobId, taskId);
      log.tinfo("Tail task", { jobId, taskId, response });
    });
  }

  async function capacity() {
    const { capacity } = await withClient(
      SchedulerClient,
      ns,
      log,
      async (client) => {
        return await client.capacity();
      }
    );
    capacity.sort((a, b) => a.freeMem - b.freeMem);
    const totalMem = capacity.reduce((acc, c) => acc + c.totalMem, 0);
    const freeMem = capacity.reduce((acc, c) => acc + c.freeMem, 0);
    const hosts = capacity.length;
    const smallestChunk = capacity.find((c) => c.freeMem > 0)?.freeMem;
    const largestChunk = capacity[capacity.length - 1]?.freeMem;
    log.tinfo("capacity", {
      freeMem: fmt.memory(freeMem),
      totalMem: fmt.memory(totalMem),
      hosts,
      smallestChunk: fmt.memory(smallestChunk || 0),
      largestChunk: fmt.memory(largestChunk || 0),
    });
    if (args.verbose as boolean) {
      for (const host of capacity) {
        log.tinfo("  host", {
          hostname: host.hostname,
          totalMem: fmt.memory(host.totalMem),
          freeMem: fmt.memory(host.freeMem),
        });
      }
    }
  }

  async function reload() {
    await withClient(SchedulerClient, ns, log, async (client) => {
      const { discovered, removed, updated } = await client.reload();
      log.tinfo("Service specs reloaded", { discovered, updated, removed });
    });
  }

  async function services() {
    const { services } = await withClient(
      SchedulerClient,
      ns,
      log,
      async (client) => {
        return await client.status();
      }
    );
    for (const service of services) {
      log.tinfo("Service", serviceStateFields(service));
    }
  }

  async function serviceStatus() {
    const name = posArgs[1] as string;
    if (name === undefined) {
      log.terror("Missing service name", { name });
      return;
    }
    await withClient(SchedulerClient, ns, log, async (client) => {
      const status = await client.serviceStatus(name);
      match(status.result, {
        Err: (e) =>
          log.terror("Failed to get service status", { reason: e.payload }),
        Ok: ({ payload: { state, logs } }) => {
          log.tinfo("Service status", serviceStateFields(state));
          if (logs.length === 0) {
            log.twarn("No logs", { service: state.spec.name });
            return;
          }
          if (!args.verbose) {
            log.tinfo("Last logs follow");
            for (const log of logs.slice(-10)) {
              ns.tprintf(log);
            }
          } else {
            log.tinfo("Logs follow");
            for (const log of logs) {
              ns.tprintf(log);
            }
          }
        },
      });
    });
  }

  async function startDaemon() {
    const pid = ns.exec(SCHEDULER_SCRIPT, ns.getHostname());
    if (pid === 0) {
      log.terror("Failed to start scheduler daemon");
    } else {
      log.tinfo("Scheduler daemon started", { pid });
      if (args.stail as boolean) {
        ns.tail(pid);
      }
    }
  }

  async function restart() {
    await exit();
    while (ns.scriptRunning(SCHEDULER_SCRIPT, ns.getHostname())) {
      await ns.sleep(100);
    }
    await startDaemon();
  }

  async function startService() {
    const name = posArgs[1] as string;
    if (name === undefined) {
      log.terror("Missing service name", { name });
      return;
    }
    try {
      await withClient(SchedulerClient, ns, log, async (client) => {
        const status = await client.startService(name);
        match(status.result, {
          Err: (e) =>
            log.terror("Failed to start service", { name, reason: e.payload }),
          Ok: ({ payload: status }) =>
            log.tinfo("Service started", serviceStatusFields(status)),
        });
      });
    } catch (e) {
      log.terror("Failed to start service", { name, reason: e });
      log.tinfo(
        "Possibly `PortRegistry` is not running, sending fire-and-forget service start request"
      );
      await new NoResponseSchedulerClient(ns, log).startServiceNoResponse(name);
    }
  }

  async function tailDaemon() {
    const process = ns.getRunningScript(SCHEDULER_SCRIPT, ns.getHostname());
    if (process === null) {
      log.terror("Scheduler daemon not running");
    } else {
      ns.tail(process.pid);
    }
  }

  async function stopService() {
    const name = posArgs[1] as string;
    if (name === undefined) {
      log.terror("Missing service name", { name });
      return;
    }
    await withClient(SchedulerClient, ns, log, async (client) => {
      const response = await client.stopService(name);
      log.tinfo("stop-service", { name, response: response.payload });
    });
  }

  async function restartService() {
    await stopService();
    await startService();
  }

  async function enableService() {
    const name = posArgs[1] as string;
    if (name === undefined) {
      log.terror("Missing service name", { name });
      return;
    }
    await withClient(SchedulerClient, ns, log, async (client) => {
      const response = await client.enableService(name);
      log.tinfo("enable-service", { name, response: response.payload });
    });
  }

  async function disableService() {
    const name = posArgs[1] as string;
    if (name === undefined) {
      log.terror("Missing service name", { name });
      return;
    }
    await withClient(SchedulerClient, ns, log, async (client) => {
      const response = await client.disableService(name);
      log.tinfo("disable-service", { name, response: response.payload });
    });
  }

  function serviceStateFields(state: ServiceState): {
    [key: string]: unknown;
  } {
    return {
      name: state.spec.name,
      ...serviceStatusFields(state.status),
      enabled: state.enabled,
    };
  }

  function serviceStatusFields(status: ServiceStatus): {
    [key: string]: unknown;
  } {
    return match(status, {
      new: () => ({ state: "new" }),
      running: ({ pid, hostname, startedAt }) => ({
        state: colors.green("running"),
        pid,
        hostname,
        startedAt: fmt.timestamp(startedAt),
        uptime: fmt.time(Date.now() - startedAt),
      }),
      stopped: ({ pid, hostname, startedAt, stoppedAt }) => ({
        state: colors.black("stopped"),
        pid,
        hostname,
        startedAt: fmt.timestamp(startedAt),
        stoppedAt: fmt.timestamp(stoppedAt),
      }),
      crashed: ({ pid, hostname, startedAt, crashedAt }) => ({
        state: colors.red("crashed"),
        pid,
        hostname,
        startedAt: fmt.timestamp(startedAt),
        crashedAt: fmt.timestamp(crashedAt),
        uptime: fmt.time(crashedAt - startedAt),
      }),
    });
  }
}

export function autocomplete(data: AutocompleteData, args: string[]): string[] {
  const commands = [
    "status",
    "capacity",
    "start-daemon",
    "stop-daemon",
    "restart-daemon",
    "tail-daemon",
    "start",
    "run",
    "kill-all",
    "kill-job",
    "tail-task",
    "reload",
    "services",
    "service-status",
    "start-service",
    "stop-service",
    "restart-service",
    "enable-service",
    "disable-service",
  ];
  const cmd = args[0];
  if (cmd === undefined) {
    return commands;
  } else if (args.length === 1) {
    return commands.filter((c) => c.startsWith(args[0]));
  } else if (["start", "run"].includes(cmd)) {
    return data.scripts.filter((s) => s.startsWith(args[1]));
  } else if (
    [
      "start-service",
      "stop-service",
      "restart-service",
      "service-status",
      "enable-service",
      "disable-service",
    ].includes(cmd)
  ) {
    return Object.keys(JSON.parse(serviceSpecs.default));
  } else {
    return [];
  }
}
