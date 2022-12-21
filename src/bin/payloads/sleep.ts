import { NS } from "@ns";
import { SupervisorCtl } from "/supervisorctl";

export async function main(ns: NS): Promise<void> {
  const supervisorCtl = new SupervisorCtl(ns);
  if (ns.args.length < 1) {
    ns.tprint("ERROR Usage: run sleep.js <ms>");
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await supervisorCtl.finished(ns.getRunningScript()!.pid, ns.getHostname());
    return;
  }
  await ns.sleep(parseInt(ns.args[0] as string, 10));
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  await supervisorCtl.finished(ns.getRunningScript()!.pid, ns.getHostname());
}
