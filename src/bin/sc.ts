// CLI to talk to SchedulerService
import { AutocompleteData, NS } from "@ns";
import { matchI } from "ts-adt";
import { Fmt } from "/fmt";
import {
  NoResponseSchedulerClient,
  withSchedulerClient,
} from "/services/Scheduler/client";
import {
  jobThreads,
  ServiceState,
  ServiceStatus,
} from "/services/Scheduler/types";
import * as serviceSpecs from "/bin/services/specs.json.txt";

const SCHEDULER_SCRIPT = "/bin/services/Scheduler.js";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const fmt = new Fmt(ns);

  const args = ns.flags([
    ["threads", 0],
    ["stail", false],
    ["verbose", false],
  ]);
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
    ns.tprint(`ERROR Invalid command: ${command}`);
  }

  async function start() {
    const threads = args.threads as number;
    if (threads <= 0) {
      ns.tprint("ERROR Invalid or missing --threads");
      return;
    }
    await withSchedulerClient(ns, async (client) => {
      ns.tprint(
        JSON.stringify(
          await client.start(
            {
              threads,
              script: posArgs[1],
              args: posArgs.slice(2),
            },
            args.stail as boolean,
            null
          )
        )
      );
    });
  }

  async function run() {
    const threads = args.threads as number;
    if (threads <= 0) {
      ns.tprint("ERROR Invalid or missing --threads");
      return;
    }
    await withSchedulerClient(ns, async (client) => {
      const response = await client.start(
        {
          threads,
          script: posArgs[1],
          args: posArgs.slice(2),
        },
        args.stail as boolean
      );
      ns.tprint(
        `INFO Started job ${response.jobId} with ${response.threads} threads, waiting for it to finish...`
      );
      await client.waitForJobFinished(response.jobId);
    });
    ns.tprint("INFO Job finished");
  }

  async function status() {
    const status = await withSchedulerClient(ns, async (client) => {
      return await client.status();
    });
    ns.tprint("INFO Scheduler status:");
    for (const job of status.jobs) {
      ns.tprint(
        `  [${job.id}] '${job.spec.script} ${job.spec.args.join(
          " "
        )}' threads: ${jobThreads(job)} / ${job.spec.threads}`
      );
      if (args.verbose as boolean) {
        for (const task of Object.values(job.tasks)) {
          ns.tprint(
            `      ${task.id} threads=${task.threads} ${task.hostname} PID ${task.pid}`
          );
        }
      }
    }
  }

  async function exit() {
    await new NoResponseSchedulerClient(ns).exit();
    ns.tprint("INFO Exit request sent");
  }

  async function killAll() {
    await new NoResponseSchedulerClient(ns).killAll();
    ns.tprint("INFO kill-all request sent");
  }

  async function killJob() {
    const jobId = posArgs[1];
    if (!jobId) {
      ns.tprint("ERROR Missing job ID");
      return;
    }
    await withSchedulerClient(ns, async (client) => {
      ns.tprint((await client.killJob(jobId)).result);
    });
  }

  async function capacity() {
    const { capacity } = await withSchedulerClient(ns, async (client) => {
      return await client.capacity();
    });
    capacity.sort((a, b) => a.freeMem - b.freeMem);
    const totalMem = capacity.reduce((acc, c) => acc + c.totalMem, 0);
    const freeMem = capacity.reduce((acc, c) => acc + c.freeMem, 0);
    const hosts = capacity.length;
    ns.tprint(
      `INFO Capacity: ${hosts} hosts, ${fmt.memory(freeMem)} / ${fmt.memory(
        totalMem
      )}`
    );

    const smallestChunk = capacity.find((c) => c.freeMem > 0)?.freeMem;
    if (smallestChunk) {
      ns.tprint(`INFO Smallest chunk: ${fmt.memory(smallestChunk)}`);
    }

    const largestChunk = capacity[capacity.length - 1]?.freeMem;
    if (largestChunk) {
      ns.tprint(`INFO Largest chunk: ${fmt.memory(largestChunk)}`);
    }
  }

  async function reload() {
    await withSchedulerClient(ns, async (client) => {
      const { discovered, removed, updated } = await client.reload();
      ns.tprint(
        `INFO Service specs reloaded. ${JSON.stringify({
          discovered,
          updated,
          removed,
        })}`
      );
    });
  }

  async function services() {
    const { services } = await withSchedulerClient(ns, async (client) => {
      return await client.status();
    });
    for (const service of services) {
      ns.tprint(`  ${service.spec.name}: ${serviceStateToString(service)}`);
    }
  }

  async function serviceStatus() {
    const name = posArgs[1] as string;
    if (name === undefined) {
      ns.tprint("ERROR Missing service name");
      return;
    }
    await withSchedulerClient(ns, async (client) => {
      const status = await client.serviceStatus(name);
      matchI(status.payload)({
        error: (e) => ns.tprint(`ERROR ${e}`),
        ok: ({ state, logs }) => {
          ns.tprint(`INFO Service state: ${serviceStateToString(state)}`);
          ns.tprint("INFO Last logs:");
          for (const log of logs.slice(-10)) {
            ns.tprint(`  ${log}`);
          }
        },
      });
    });
  }

  async function startDaemon() {
    const pid = ns.exec(SCHEDULER_SCRIPT, ns.getHostname());
    if (pid === 0) {
      ns.tprint("ERROR Failed to start scheduler daemon");
    } else {
      ns.tprint(`INFO Scheduler daemon started (PID ${pid})`);
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
      ns.tprint("ERROR Missing service name");
      return;
    }
    try {
      await withSchedulerClient(ns, async (client) => {
        const status = await client.startService(name);
        matchI(status.payload)({
          error: (e) => ns.tprint(`ERROR ${e.kind}`),
          ok: ({ status }) =>
            ns.tprint(`INFO Service started: ${serviceStatusToString(status)}`),
        });
      });
    } catch (e) {
      ns.tprint(`ERROR ${e}`);
      ns.tprint(
        "Possibly `PortRegistry` is not running, sending fire-and-forget service start request"
      );
      await new NoResponseSchedulerClient(ns).startServiceNoResponse(name);
    }
  }

  async function tailDaemon() {
    const process = ns.getRunningScript(SCHEDULER_SCRIPT, ns.getHostname());
    if (process === null) {
      ns.tprint("ERROR Scheduler daemon not running");
    } else {
      ns.tail(process.pid);
    }
  }

  async function stopService() {
    const name = posArgs[1] as string;
    if (name === undefined) {
      ns.tprint("ERROR Missing service name");
      return;
    }
    await withSchedulerClient(ns, async (client) => {
      const status = await client.stopService(name);
      ns.tprint(`Stopping ${name}: ${status.payload}`);
    });
  }

  async function restartService() {
    await stopService();
    await startService();
  }

  async function enableService() {
    const name = posArgs[1] as string;
    if (name === undefined) {
      ns.tprint("ERROR Missing service name");
      return;
    }
    await withSchedulerClient(ns, async (client) => {
      const status = await client.enableService(name);
      ns.tprint(`Enabling ${name}: ${status.payload}`);
    });
  }

  async function disableService() {
    const name = posArgs[1] as string;
    if (name === undefined) {
      ns.tprint("ERROR Missing service name");
      return;
    }
    await withSchedulerClient(ns, async (client) => {
      const status = await client.disableService(name);
      ns.tprint(`Disabling ${name}: ${status.payload}`);
    });
  }

  function serviceStateToString(state: ServiceState): string {
    return (
      serviceStatusToString(state.status) +
      " " +
      (state.enabled ? "(enabled)" : "(disabled)")
    );
  }

  function serviceStatusToString(status: ServiceStatus): string {
    return matchI(status)({
      new: () => "New",
      running: ({ pid, hostname, startedAt }) =>
        `Running on ${hostname} (PID ${pid}) since ${fmt.timestamp(startedAt)}`,
      stopped: ({ stoppedAt }) => `Stopped at ${fmt.timestamp(stoppedAt)}`,
      crashed: ({ pid, hostname, startedAt, crashedAt }) => {
        return `Crashed on ${hostname} (PID ${pid}) at ${fmt.timestamp(
          crashedAt
        )} after ${fmt.time(crashedAt - startedAt)}`;
      },
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
