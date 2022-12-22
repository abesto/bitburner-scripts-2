import { NS } from "@ns";
import { thisProcessFinished } from "/supervisorctl";

export async function main(ns: NS): Promise<void> {
  const host = ns.args[0] as string;
  if (!host) {
    throw new Error("Usage: run grow.js <host>");
  }
  const mult = await ns.grow(host);
  // TODO report mult
  thisProcessFinished(ns);
}
