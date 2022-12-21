import { NS, NetscriptPort } from "@ns";

export function supervisorControl(ns: NS): NetscriptPort {
  return ns.getPortHandle(1);
}
