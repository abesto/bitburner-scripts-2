import { NS } from "@ns";
import minimist from "minimist";

import { SupervisorCtl } from "/supervisorctl";
import { SupervisorEvents } from "/supervisorEvent";

const SUPERVISOR_JS = "/dist/bin/supervisor.js";

export async function main(ns: NS): Promise<void> {
  const ctl = new SupervisorCtl(ns);
  const events = new SupervisorEvents(ns);
  const args = minimist(ns.args as string[]);

  if (args._[0] == "start-daemon") {
    await startDaemon();
    return;
  }

  if (!ns.scriptRunning(SUPERVISOR_JS, ns.getHostname())) {
    ns.tprint("ERROR Supervisor not running");
    return;
  }

  if (args._[0] === "echo") {
    await ctl.echo(args._.slice(1).join(" "));
  } else if (args._[0] === "status") {
    await ctl.status();
  } else if (args._[0] === "start") {
    await start();
  } else if (args._[0] === "exit") {
    await exit();
  } else if (args._[0] === "restart-daemon") {
    await exit();
    await ns.sleep(0);
    await startDaemon();
  } else if (args._[0] === "tail-daemon") {
    await ctl.tailDaemon();
  } else {
    ns.tprint("ERROR Unknown command");
  }

  async function start() {
    if (!args.threads) {
      ns.tprint("ERROR threads not specified");
      return;
    }
    const requestId = await ctl.start(args._[1], args._.slice(2), args.threads);
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
