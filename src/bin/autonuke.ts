import { NS } from "@ns";

import { autonuke } from "/autonuke";
import { discoverServers } from "/discoverServers";

export async function main(ns: NS): Promise<void> {
  for (const hostname of discoverServers(ns)) {
    const server = ns.getServer(hostname);
    if (server.hasAdminRights) {
      ns.tprint(`SKIP ${hostname}: already have root`);
      continue;
    }

    if (server.backdoorInstalled) {
      ns.tprint(`SKIP ${hostname}: backdoor already installed`);
      continue;
    }

    if (autonuke(ns, server, true)) {
      ns.tprint(`NUKED ${hostname}`);
    } else {
      ns.tprint(`FAILED ${hostname}`);
    }
  }
}
