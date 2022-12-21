import { NS } from "@ns";
import minimist from "minimist";

import { SupervisorCtl } from "/supervisorctl";

export async function main(ns: NS): Promise<void> {
  const ctl = new SupervisorCtl(ns);
  const args = minimist(ns.args as string[]);

  if (args._[0] == "start-daemon") {
    if (ns.scriptRunning("supervisor.js", ns.getHostname())) {
      ns.tprint("ERROR Supervisor already running");
      return;
    }
    const pid = ns.exec("supervisor.js", ns.getHostname());
    ns.tprint(`Started supervisor with pid ${pid}`);
    return;
  }

  if (!ns.scriptRunning("supervisor.js", ns.getHostname())) {
    ns.tprint("ERROR Supervisor not running");
    return;
  }

  if (args._[0] === "echo") {
    await ctl.echo(args._.slice(1).join(" "));
  } else if (args._[0] === "status") {
    await ctl.status();
  } else if (args._[0] === "start") {
    if (!args.threads) {
      ns.tprint("ERROR threads not specified");
      return;
    }
    await ctl.start(args._[1], args._.slice(2), args.threads);
  } else if (args._[0] === "exit") {
    await ctl.exit();
  } else if (args._[0] === "tail-daemon") {
    await ctl.tailDaemon();
  } else {
    ns.tprint("ERROR Unknown command");
  }
}
