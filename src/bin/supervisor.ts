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
        if (await checkCrashes()) {
          ns.print("Got crash");
          return;
        }
        await ns.asleep(1000);
      }
    }

    cancel() {
      this.cancelled = true;
    }
  }

  class StartLaterWatcher {
    private cancelled = false;

    async watch() {
      while (!this.cancelled) {
        ns.print("Later is now");
        if (await checkStartLater()) {
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
      //const startLaterWatcher = new StartLaterWatcher();
      await Promise.any([
        ctlPort.nextWrite(),
        crashWatcher.watch(),
        /*startLaterWatcher.watch(),*/
      ]);
      crashWatcher.cancel();
      //startLaterWatcher.cancel();
      await ns.sleep(0);
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
      await start(message);
    } else if (message.type === "finished") {
      await finished(message);
    } else if (message.type === "tail-daemon") {
      ns.tail();
    } else if (message.type === "start-later") {
      await startLater(message);
    } else if (message.type === "kill-all") {
      await killAll();
    } else if (message.type === "capacity") {
      capacity();
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

  function capacity() {
    const data = exploreCapacity(ns);
    const sumFreeMem = data.reduce((acc, x) => acc + x.freeMem, 0);
    const sumTotalMem = data.reduce((acc, x) => acc + x.totalMem, 0);
    ns.tprint(
      `INFO Free capacity: ${fmt.memory(sumFreeMem)} / ${fmt.memory(
        sumTotalMem
      )}`
    );
  }

  async function killAll() {
    ns.print("Killing all managed processes");
    const memdb = await db(ns);
    for (const batchId in memdb.supervisor.batches) {
      const batch = memdb.supervisor.batches[batchId];
      for (const hostname in batch.deployments) {
        ns.kill(batch.script, hostname, ...batch.args, "--batch", batchId);
      }
    }
    await dbLock(ns, "kill-all", async (memdb) => {
      memdb.supervisor.batches = {};
      return memdb;
    });
  }

  async function finished(message: {
    type: "finished";
    payload: { pid: number; hostname: string };
  }) {
    const { pid, hostname } = message.payload;
    await dbLock(ns, "finished", async (memdb) => {
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
      preferHome: boolean;
    };
  }) {
    const { script, args, threads, requestId, preferHome } = message.payload;

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
    capacity.sort((a, b) => {
      if (a.hostname === "home") {
        return -1;
      } else if (b.hostname === "home") {
        return 1;
      } else {
        return 0;
      }
    });
    if (!preferHome) {
      capacity.reverse();
    }

    let scheduled = 0;
    for (const { hostname, freeMem, cores } of capacity) {
      if (scheduled >= threads) {
        break;
      }
      const availableThreads = Math.max(
        0,
        Math.floor(
          hostname === "home"
            ? Math.floor(
                (freeMem - (await db(ns)).config.supervisor.reserveHomeRam) /
                  scriptRam
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
    }

    batch.threads = scheduled;
    await dbLock(ns, "start", async (memdb) => {
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

  async function startLater(message: {
    type: "start-later";
    payload: {
      when: number;
      script: string;
      args: string[];
      threads: number;
      requestId: string;
    };
  }) {
    const { script, args, threads, requestId, when } = message.payload;
    ns.print(
      `INFO [req=${requestId}] Saving '${script} ${args}' with threads ${threads}, will start in ${fmt.time(
        when - Date.now()
      )}`
    );
    await dbLock(ns, "startLater", async (memdb) => {
      memdb.supervisor.pending.push(message.payload);
      memdb.supervisor.pending.sort((a, b) => a.when - b.when);
      return memdb;
    });
  }

  async function checkStartLater(): Promise<boolean> {
    const now = Date.now();
    let retval = false;
    await dbLock(ns, "checkStartLater", async (memdb) => {
      const pending = memdb.supervisor.pending;
      // pending is sorted
      while (pending.length > 0 && pending[0].when <= now) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const { script, args, threads, requestId } = pending.shift()!;
        syntheticEvents.push({
          type: "start",
          payload: { script, args, threads, requestId, preferHome: false },
        });
        retval = true;
      }
      return memdb;
    });
    return retval;
  }

  async function status() {
    ns.tprint("INFO I'm alive! Available capacity:");
    for (const { hostname, freeMem, cores, totalMem } of exploreCapacity(ns)) {
      ns.tprint(
        `  ${hostname}: free ${fmt.memory(freeMem)} / ${fmt.memory(
          totalMem
        )} (${cores} cores)`
      );
    }
    ns.tprint("INFO Running batches:");
    for (const batchId in (await db(ns)).supervisor.batches) {
      const batch = (await db(ns)).supervisor.batches[batchId];
      ns.tprint(`  ${batchId}: ${batch.script} ${batch.args}`);
      for (const hostname in batch.deployments) {
        const deployment = batch.deployments[hostname];
        ns.tprint(
          `    ${hostname}: ${deployment.threads} (PID ${deployment.pid})`
        );
      }
    }
  }

  function echo(message: { type: "echo"; payload: string }) {
    ns.tprint(message.payload);
  }

  async function checkCrashes(): Promise<boolean> {
    let retval = false;
    const memdb = await db(ns);
    for (const batchId in memdb.supervisor.batches) {
      const batch = memdb.supervisor.batches[batchId];
      for (const hostname in batch.deployments) {
        const deployment = batch.deployments[hostname];
        if (!ns.isRunning(deployment.pid, hostname)) {
          ns.print(
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
  totalMem: number;
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
    capacities.push({
      hostname,
      freeMem,
      totalMem: server.maxRam,
      cores: server.cpuCores,
    });
  }
  return capacities;
}
