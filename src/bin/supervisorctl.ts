import { NS } from "@ns";

import { SupervisorCtl } from "/supervisorctl";
import { SupervisorEvents } from "/supervisorEvent";

const SUPERVISOR_JS = "/dist/bin/supervisor.js";

export async function main(ns: NS): Promise<void> {
  const ctl = new SupervisorCtl(ns);
  const events = new SupervisorEvents(ns);
  const args = ns.flags([["threads", 0]]);

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
  } else if (command === "exit") {
    await exit();
  } else if (command === "restart-daemon") {
    await exit();
    await ns.sleep(0);
    await startDaemon();
  } else if (command === "tail-daemon") {
    await ctl.tailDaemon();
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
