import { NS } from "@ns";

import { discoverServers } from "/discoverServers";
import { Fmt } from "/fmt";
import HwgwEstimator from "/HwgwEstimator";
import { Log } from "/log";
import { db } from "/services/Database/client";

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "target");
  const estimator = new HwgwEstimator(ns);

  const memdb = await db(ns, log);

  const servers = discoverServers(ns);
  servers.sort((a, b) => Weight(ns, b) - Weight(ns, a));

  const data = [];
  for (const server of servers) {
    if (data.length >= 10) {
      break;
    }
    const maxMoney = ns.getServerMaxMoney(server);
    if (maxMoney === 0 || ns.hackAnalyze(server) === 0) {
      continue;
    }
    const estimate = await estimator.stableMaxDepth(
      server,
      memdb.config.hwgw.moneyThreshold,
      memdb.config.simpleHack.moneyThreshold
    );
    data.push({
      server,
      maxMoney,
      ...estimate,
    });
  }

  const fmt = new Fmt(ns);
  for (const item of data.slice(0, 20)) {
    const requiredHackingLevel = ns.getServerRequiredHackingLevel(item.server);

    log.tinfo(item.server, {
      hackLevel: requiredHackingLevel,
      ...item,
      maxMoney: fmt.money(item.maxMoney),
      period: fmt.timeSeconds(item.period),
      peakRam: fmt.memory(item.peakRam),
      moneyPerSec: fmt.money(item.moneyPerSec),
    });
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
  if (so.requiredHackingSkill === undefined) return 0;
  if (so.requiredHackingSkill > player.skills.hacking) return 0;

  // Default pre-Formulas.exe weight. minDifficulty directly affects times, so it substitutes for min security times
  if (so.moneyMax === undefined || so.minDifficulty === undefined) return 0;
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
