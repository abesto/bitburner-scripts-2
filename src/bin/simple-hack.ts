import { NS } from "@ns";
import minimist from "minimist";

export async function main(ns: NS): Promise<void> {
  const argv = minimist(ns.args as string[]);
  ns.tprint(argv);
}
