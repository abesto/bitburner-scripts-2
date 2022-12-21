import { NS } from "@ns";

import { supervisorControl } from "/ports";
import { Message } from "../supervisorctl";
import { autonuke } from "/autonuke";
import { discoverServers } from "/discoverServers";
import { Fmt } from "/fmt";
import { db, saveDb, SupervisorBatch } from "/database";

export async function main(ns: NS): Promise<void> {
  const port = supervisorControl(ns);
  const fmt = new Fmt(ns);

  let exit = false;
  while (!exit) {
    if (port.empty()) {
      await port.nextWrite();
    }
    const messageRaw = port.read().toString();
    ns.print(`Got message: ${messageRaw}`);
    const message = JSON.parse(messageRaw) as Message;
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

  function finished(message: {
    type: "finished";
    payload: { pid: number; hostname: string };
  }) {
    const { pid, hostname } = message.payload;
    const memdb = db(ns);
    for (let id = 0; id < memdb.supervisor.processes.length; id++) {
      const batch = memdb.supervisor.processes[id];
      const deployment = batch.deployments[hostname];
      if (deployment?.pid === pid) {
        ns.tprint(
          `INFO ${hostname} finished '${batch.script} ${batch.args}' with ${deployment.threads} (PID ${pid}, batch ${id})`
        );
        delete batch.deployments[hostname];
        if (Object.keys(batch.deployments).length === 0) {
          ns.tprint(
            `SUCCESS Batch ${id} finished (${batch.script} ${batch.args} with ${batch.threads} threads)`
          );
          memdb.supervisor.processes.splice(id, 1);
        }
        saveDb(ns, memdb);
        return;
      }
    }
    ns.tprint(`WARN Could not find batch for ${hostname} PID ${pid}`);
  }

  function start(message: {
    type: "start";
    payload: { script: string; args: string[]; threads: number };
  }) {
    const { script, args, threads } = message.payload;

    if (!ns.fileExists(script, "home")) {
      ns.tprint(`ERROR Could not find ${script}`);
      return;
    }

    const batchId = Math.random(); // TODO use a proper ID, store it
    const batch: SupervisorBatch = { script, args, threads, deployments: {} };
    const scriptRam = ns.getScriptRam(script);
    ns.tprint(
      `Starting ${script} with args ${args} and threads ${threads} (RAM: ${fmt.memory(
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
        ns.tprint(`WARN Could not copy ${script} to ${hostname}`);
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
          `WARN Could not start ${script} on ${hostname} (tried ${threadsThisHost} threads)`
        );
        continue;
      }
      scheduled += threadsThisHost * cores;
      ns.tprint(
        `INFO Started ${script} on ${hostname} (PID: ${pid}, threads: ${threadsThisHost}, cores: ${cores}), remaining: ${
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

    const memdb = db(ns);
    memdb.supervisor.processes.push(batch);
    saveDb(ns, memdb);

    if (scheduled < threads) {
      ns.tprint(
        `ERROR Could not schedule ${threads} threads, scheduled ${scheduled}`
      );
    } else {
      ns.tprint(`SUCCESS Scheduled ${scheduled} threads`);
    }
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
