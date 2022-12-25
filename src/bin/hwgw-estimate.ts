import { AutocompleteData, NS } from '@ns';

import { db } from '/database';
import { Fmt } from '/fmt';
import { Log } from '/log';

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const fmt = new Fmt(ns);
  const log = new Log(ns, "hwgw-estimate");

  const args = ns.flags([]);
  const host = (args._ as string[])[0];

  if (!host) {
    log.terror("Usage: run hwgw-estimate.js", { args });
    return;
  }

  const spacing = (await db(ns, log)).config.hwgw.spacing;

  const moneyMax = ns.getServerMaxMoney(host);

  const hackWeakenThreads = Math.ceil(ns.getServerSecurityLevel(host) / 0.05);

  const growMultiplier = moneyMax / ns.getServerMoneyAvailable(host);
  const wantGrowThreads = Math.ceil(ns.growthAnalyze(host, growMultiplier));
  const growSecurityGrowth = ns.growthAnalyzeSecurity(wantGrowThreads);
  const wantGrowWeakenThreads = Math.ceil(growSecurityGrowth / 0.05);

  const weakenLength = ns.getWeakenTime(host);

  const ramRequirement =
    wantGrowThreads * ns.getScriptRam("/bin/payloads/grow.js") +
    wantGrowWeakenThreads * ns.getScriptRam("/bin/payloads/weaken.js") +
    hackWeakenThreads * ns.getScriptRam("/bin/payloads/weaken.js");

  const batchLen = weakenLength + spacing * 2;

  log.tinfo("Estimate for initial grow/weaken", {
    host,
    wantGrowThreads,
    wantGrowWeakenThreads,
    hackWeakenThreads,
    ramRequirement: fmt.memory(ramRequirement),
    batchLen: fmt.time(batchLen),
  });
}

export function autocomplete(data: AutocompleteData, args: string[]): string[] {
  return data.servers;
}
