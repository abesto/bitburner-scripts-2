import { NS } from "@ns";
import { SupervisorCtl } from "/supervisorctl";

export async function main(ns: NS): Promise<void> {
  await ns.sleep(parseInt(ns.args[0] as string, 10));
  const supervisorCtl = new SupervisorCtl(ns);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  await supervisorCtl.finished(ns.getRunningScript()!.pid, ns.getHostname());
}
