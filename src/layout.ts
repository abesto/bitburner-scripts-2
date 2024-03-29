import { NS } from "@ns";

export async function hwgwController(
  ns: NS,
  pid: number | undefined = undefined
) {
  ns.tail(pid);
  await ns.sleep(0);
  ns.resizeTail(930, 345, pid);
  ns.moveTail(1413, 0, pid);
}

export async function hwgwMonitor(ns: NS, pid: number | undefined = undefined) {
  ns.tail(pid);
  await ns.sleep(0);
  ns.moveTail(1413, 350, pid);
  ns.resizeTail(1145, 890, pid);
}
