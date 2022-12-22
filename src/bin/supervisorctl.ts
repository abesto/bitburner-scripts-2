import { AutocompleteData, NS } from "@ns";

import { SupervisorCtl } from "/supervisorctl";
import { SupervisorEvents } from "/supervisorEvent";

const SUPERVISOR_JS = "/dist/bin/supervisor.js";

export async function main(ns: NS): Promise<void> {
  const ctl = new SupervisorCtl(ns);
  const events = new SupervisorEvents(ns);
  const args = ns.flags([
    ["threads", 0],
    ["in-seconds", 0],
  ]);

  const posArgs = args._ as string[];
  const command = posArgs[0];

  if (command == "start-daemon") {
    await startDaemon();
    return;
  }

  if (!ns.scriptRunning(SUPERVISOR_JS, ns.getHostname())) {
    ns.tprint("ERROR Supervisor not running");
    return;
  }

  if (command === "echo") {
    await ctl.echo(posArgs.slice(1).join(" "));
  } else if (command === "status") {
    await ctl.status();
  } else if (command === "start") {
    await start();
  } else if (command === "start-later") {
    await startLater();
  } else if (command === "exit") {
    await exit();
  } else if (command === "restart-daemon") {
    await exit();
    await ns.sleep(0);
    await startDaemon();
  } else if (command === "tail-daemon") {
    await ctl.tailDaemon();
  } else if (command === "kill-all") {
    await ctl.killAll();
  } else if (command == "capacity") {
    await ctl.capacity();
  } else {
    ns.tprint("ERROR Unknown command");
  }

  async function start() {
    const threads = args.threads as number;
    if (!threads) {
      ns.tprint("ERROR threads not specified");
      return;
    }
    const requestId = await ctl.start(posArgs[1], posArgs.slice(2), threads);
    const batch = await events.waitForBatchStarted(requestId);
    ns.tprint(`Started batch ${batch.batchId} with ${batch.threads} threads`);
    await events.waitForBatchDone(batch.batchId);
    ns.tprint(`Finished batch ${batch.batchId}`);
  }

  async function startLater() {
    const threads = args.threads as number;
    if (!threads) {
      ns.tprint("ERROR --threads not specified");
      return;
    }
    const inSeconds = args["in-seconds"] as number;
    if (!inSeconds) {
      ns.tprint("ERROR --in-seconds not specified");
      return;
    }
    const requestId = await ctl.startLater(
      Date.now() + inSeconds * 1000,
      posArgs[1],
      posArgs.slice(2),
      threads
    );
    const batch = await events.waitForBatchStarted(requestId);
    ns.tprint(`Started batch ${batch.batchId} with ${batch.threads} threads`);
    await events.waitForBatchDone(batch.batchId);
    ns.tprint(`Finished batch ${batch.batchId}`);
  }

  async function startDaemon() {
    if (ns.scriptRunning(SUPERVISOR_JS, ns.getHostname())) {
      ns.tprint("ERROR Supervisor already running");
      return;
    }
    const pid = ns.exec(SUPERVISOR_JS, ns.getHostname());
    ns.tprint(`Started supervisor with pid ${pid}`);
  }

  async function exit() {
    await ctl.exit();
  }
}

export function autocomplete(data: AutocompleteData, args: string[]): string[] {
  const commands = [
    "echo",
    "status",
    "start",
    "exit",
    "restart-daemon",
    "tail-daemon",
  ];
  if (args.length === 0) {
    return commands;
  } else if (args.length === 1) {
    return commands.filter((c) => c.startsWith(args[0]));
  } else if (args[0] === "start") {
    return data.scripts.filter((s) => s.startsWith(args[1]));
  } else {
    return [];
  }
}
