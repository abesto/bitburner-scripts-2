import { NS } from "@ns";
import { thisProcessFinished } from "/supervisorctl";

export async function main(ns: NS): Promise<void> {
  if (ns.args.length < 1) {
    ns.tprint("ERROR Usage: run sleep.js <ms>");
    thisProcessFinished(ns);
    return;
  }
  await ns.sleep(parseInt(ns.args[0] as string, 10));
  thisProcessFinished(ns);
}
