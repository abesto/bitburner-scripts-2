import { NS } from '@ns';

import { discoverServers } from '/discoverServers';
import { Fmt } from '/fmt';

export async function main(ns: NS): Promise<void> {
  const hackingLevelThreshold = ns.getPlayer().skills.hacking / 3;
  const servers = discoverServers(ns);

  // simple
  /*
  servers = servers.filter(
    (server) => ns.getServerRequiredHackingLevel(server) < hackingLevelThreshold
  );
  servers.sort((a, b) => {
    const aMaxMoney = ns.getServerMaxMoney(a);
    const bMaxMoney = ns.getServerMaxMoney(b);
    return bMaxMoney - aMaxMoney;
  });
  */
  servers.sort((a, b) => Weight(ns, b) - Weight(ns, a));

  const fmt = new Fmt(ns);
  for (const server of servers.slice(0, 20)) {
    const maxMoney = ns.getServerMaxMoney(server);
    const requiredHackingLevel = ns.getServerRequiredHackingLevel(server);
    ns.tprint(
      `${server}: maxMoney=${fmt.money(
        maxMoney
      )} hackingLevel=${requiredHackingLevel}`
    );
  }
}

// from Discord pinned post
function Weight(ns: NS, server: string) {
  if (!server) return 0;

  // Don't ask, endgame stuff
  if (server.startsWith("hacknet-node")) return 0;

  // Get the player information
  const player = ns.getPlayer();

  // Get the server information
  const so = ns.getServer(server);

  // Set security to minimum on the server object (for Formula.exe functions)
  so.hackDifficulty = so.minDifficulty;

  // We cannot hack a server that has more than our hacking skill so these have no value
  if (so.requiredHackingSkill > player.skills.hacking) return 0;

  // Default pre-Formulas.exe weight. minDifficulty directly affects times, so it substitutes for min security times
  let weight = so.moneyMax / so.minDifficulty;

  // If we have formulas, we can refine the weight calculation
  if (ns.fileExists("Formulas.exe")) {
    // We use weakenTime instead of minDifficulty since we got access to it,
    // and we add hackChance to the mix (pre-formulas.exe hack chance formula is based on current security, which is useless)
    weight =
      (so.moneyMax / ns.formulas.hacking.weakenTime(so, player)) *
      ns.formulas.hacking.hackChance(so, player);
  }
  // If we do not have formulas, we can't properly factor in hackchance, so we lower the hacking level tolerance by half
  else if (so.requiredHackingSkill > player.skills.hacking / 2) return 0;

  return weight;
}
