import { NS } from "@ns";
import { discoverServers } from "/discoverServers";
import { Fmt } from "/fmt";

export async function main(ns: NS): Promise<void> {
  const hackingLevelThreshold = ns.getPlayer().skills.hacking / 3;
  const servers = discoverServers(ns).filter(
    (server) => ns.getServerRequiredHackingLevel(server) < hackingLevelThreshold
  );
  servers.sort((a, b) => {
    const aMaxMoney = ns.getServerMaxMoney(a);
    const bMaxMoney = ns.getServerMaxMoney(b);
    return bMaxMoney - aMaxMoney;
  });

  const fmt = new Fmt(ns);
  for (const server of servers.slice(0, 10)) {
    const maxMoney = ns.getServerMaxMoney(server);
    const requiredHackingLevel = ns.getServerRequiredHackingLevel(server);
    ns.tprint(
      `${server}: maxMoney=${fmt.money(
        maxMoney
      )} hackingLevel=${requiredHackingLevel}`
    );
  }
}
