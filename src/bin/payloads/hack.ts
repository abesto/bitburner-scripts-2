import { NS } from "@ns";
import { thisProcessFinished } from "/supervisorctl";

export async function main(ns: NS): Promise<void> {
  const host = ns.args[0] as string;
  if (!host) {
    throw new Error("Usage: run hack.js <host>");
  }
  const money = await ns.hack(host);
  // TODO report moneys
  thisProcessFinished(ns);
}
