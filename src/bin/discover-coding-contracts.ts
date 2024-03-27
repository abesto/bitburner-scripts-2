import { NS } from "@ns";

import { discoverServers } from "/discoverServers";

export async function main(ns: NS): Promise<void> {
  for (const host of discoverServers(ns)) {
    for (const file of ns.ls(host)) {
      if (file.endsWith(".cct")) {
        ns.tprint(`${host} ${file}`);
      }
    }
  }
}
