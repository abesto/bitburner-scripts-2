import { NS } from "@ns";

import { autonuke } from "/autonuke";
import { discoverServers } from "/discoverServers";

export async function main(ns: NS): Promise<void> {
  for (const hostname of discoverServers(ns)) {
    if (ns.hasRootAccess(hostname)) {
      ns.tprint(`SKIP ${hostname}: already have root`);
      continue;
    }

    if (ns.getServer(hostname).backdoorInstalled) {
      ns.tprint(`SKIP ${hostname}: backdoor already installed`);
      continue;
    }

    if (autonuke(ns, hostname, true)) {
      ns.tprint(`NUKED ${hostname}`);
    } else {
      ns.tprint(`FAILED ${hostname}`);
    }
  }
}
