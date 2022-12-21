import { NS } from "@ns";

import { supervisorControl } from "/ports";
import { Message } from "/supervisorctl";
import { autonuke } from "/autonuke";
import { discoverServers } from "/discoverServers";
import { Fmt } from "/fmt";
import { db, dbLock, SupervisorBatch } from "/database";
import { SupervisorEvents } from "/supervisorEvent";

export async function main(ns: NS): Promise<void> {
  class CrashWatcher {
    private cancelled = false;

    async watch() {
      while (!this.cancelled) {
        if (checkCrashes()) {
          return;
        }
        await ns.asleep(1000);
      }
    }

    cancel() {
      this.cancelled = true;
    }
  }

  const ctlPort = supervisorControl(ns);
  const eventsClient = new SupervisorEvents(ns);
  const fmt = new Fmt(ns);

  const syntheticEvents: Message[] = [];

  ns.disableLog("ALL");

  let exit = false;
  while (!exit) {
    if (ctlPort.empty() && syntheticEvents.length === 0) {
      const crashWatcher = new CrashWatcher();
      await Promise.any([ctlPort.nextWrite(), crashWatcher.watch()]);
      crashWatcher.cancel();
      continue;
    }
    const message = nextMessage();
    if (message.type === "echo") {
      echo(message);
    } else if (message.type === "status") {
      status();
    } else if (message.type === "exit") {
      ns.tprint("Exiting...");
      exit = true;
    } else if (message.type === "start") {
      start(message);
    } else if (message.type === "finished") {
      finished(message);
    } else if (message.type === "tail-daemon") {
      ns.tail();
    } else {
      ns.tprint(`WARN Unknown message type ${JSON.stringify(message)}`);
    }
  }

  function nextMessage(): Message {
    const message = syntheticEvents.pop();
    if (message === undefined) {
      const messageRaw = ctlPort.read().toString();
      ns.print(`Got message: ${messageRaw}`);
      return JSON.parse(messageRaw);
    } else {
      ns.print(`Got synthetic message: ${JSON.stringify(message)}`);
      return message;
    }
  }

  function finished(message: {
    type: "finished";
    payload: { pid: number; hostname: string };
  }) {
    const { pid, hostname } = message.payload;
    dbLock(ns, async (memdb) => {
      for (const batchId in memdb.supervisor.batches) {
        const batch = memdb.supervisor.batches[batchId];
        const deployment = batch.deployments[hostname];
        if (deployment?.pid === pid) {
          ns.print(
            `INFO [bat=${batchId}] ${hostname} finished '${batch.script} ${batch.args}' with ${deployment.threads} (PID ${pid}})`
          );
          delete batch.deployments[hostname];
          if (Object.keys(batch.deployments).length === 0) {
            ns.print(
              `SUCCESS [bat=${batchId}] finished (${batch.script} ${batch.args} with ${batch.threads} threads)`
            );
            delete memdb.supervisor.batches[batchId];

            eventsClient.batchDone(batchId);
          }
          return memdb;
        }
      }
      ns.tprint(`WARN Could not find batch for ${hostname} PID ${pid}`);
      return;
    });
  }

  async function start(message: {
    type: "start";
    payload: {
      script: string;
      args: string[];
      threads: number;
      requestId: string;
    };
  }) {
    const { script, args, threads, requestId } = message.payload;

    if (!ns.fileExists(script, "home")) {
      ns.tprint(`ERROR Could not find ${script}`);
      return;
    }

    const batchId =
      Math.random().toString(36).substring(2) + "." + Date.now().toString(36);
    const batch: SupervisorBatch = { script, args, threads, deployments: {} };
    const scriptRam = ns.getScriptRam(script);
    ns.print(
      `INFO [req=${requestId}] Starting ${script} with args ${args} and threads ${threads} (RAM: ${fmt.memory(
        scriptRam
      )})`
    );
    const capacity = exploreCapacity(ns);
    let scheduled = 0;
    for (const { hostname, freeMem, cores } of capacity) {
      const availableThreads = Math.max(
        0,
        Math.floor(
          hostname === "home"
            ? Math.floor(
                (freeMem - db(ns).config.supervisor.reserveHomeRam) / scriptRam
              )
            : Math.floor(freeMem / scriptRam)
        )
      );
      if (availableThreads < 1) {
        continue;
      }
      if (!ns.scp(script, hostname)) {
        ns.tprint(
          `WARN [req=${requestId}] Could not copy ${script} to ${hostname}`
        );
        continue;
      }
      const threadsThisHost = Math.min(availableThreads, threads - scheduled);
      const pid = ns.exec(
        script,
        hostname,
        threadsThisHost,
        ...args,
        "--batch",
        batchId
      );
      if (pid === 0) {
        ns.tprint(
          `WARN [req=${requestId}] Could not start ${script} on ${hostname} (tried ${threadsThisHost} threads)`
        );
        continue;
      }
      scheduled += threadsThisHost * cores;
      ns.print(
        `INFO [req=${requestId}] Started ${script} on ${hostname} (PID: ${pid}, threads: ${threadsThisHost}, cores: ${cores}), remaining: ${
          threads - scheduled
        }`
      );
      batch.deployments[hostname] = {
        pid,
        threads: threadsThisHost,
      };
      if (scheduled >= threads) {
        break;
      }
    }

    batch.threads = scheduled;
    dbLock(ns, async (memdb) => {
      memdb.supervisor.batches[batchId] = batch;
      return memdb;
    });

    if (scheduled < threads) {
      ns.print(
        `WARN [req=${requestId}] Could not schedule ${threads} threads, scheduled ${scheduled}`
      );
    } else {
      ns.print(`SUCCESS [req=${requestId}] Scheduled ${scheduled} threads`);
    }

    await eventsClient.batchStarted(requestId, batchId, scheduled);
  }

  function status() {
    ns.tprint("INFO I'm alive! Available capacity:");
    for (const { hostname, freeMem, cores } of exploreCapacity(ns)) {
      ns.tprint(`  ${hostname}: ${fmt.memory(freeMem)} (${cores} cores)`);
    }
  }

  function echo(message: { type: "echo"; payload: string }) {
    ns.tprint(message.payload);
  }

  function checkCrashes(): boolean {
    let retval = false;
    const memdb = db(ns);
    for (const batchId in memdb.supervisor.batches) {
      const batch = memdb.supervisor.batches[batchId];
      for (const hostname in batch.deployments) {
        const deployment = batch.deployments[hostname];
        if (!ns.isRunning(deployment.pid, hostname)) {
          ns.tprint(
            `WARN [bat=${batchId}] ${hostname} crashed '${batch.script} ${batch.args}' with ${deployment.threads} (PID ${deployment.pid})`
          );
          syntheticEvents.push({
            type: "finished",
            payload: {
              hostname,
              pid: deployment.pid,
            },
          });
          retval = true;
        }
      }
    }
    return retval;
  }
}

type Capacity = {
  hostname: string;
  freeMem: number;
  cores: number;
};

function exploreCapacity(ns: NS): Capacity[] {
  const hostnames = discoverServers(ns);
  const capacities = [];
  for (const hostname of hostnames) {
    if (!autonuke(ns, hostname)) {
      continue;
    }
    const server = ns.getServer(hostname);
    const freeMem = server.maxRam - ns.getServerUsedRam(hostname);
    if (freeMem < 1) {
      continue;
    }
    capacities.push({
      hostname,
      freeMem,
      cores: server.cpuCores,
    });
  }
  return capacities;
}
