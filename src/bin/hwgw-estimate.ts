import { AutocompleteData, NS } from '@ns';

import { db } from '/database';
import { Fmt } from '/fmt';
import { Log } from '/log';

export async function main(ns: NS): Promise<void> {
  const fmt = new Fmt(ns);
  const log = new Log(ns, "hwgw-estimate");
  const memdb = await db(ns, log);

  const args = ns.flags([
    ["money-threshold", memdb.config.hwgw.moneyThreshold],
  ]);
  const host = (args._ as string[])[0];
  const moneyThresholdConfig = args["money-threshold"] as number;

  if (!host) {
    log.terror("Usage: run hwgw-estimate.js", { args });
    return;
  }
  const spacing = memdb.config.hwgw.spacing;

  initial();
  stable();

  function initial() {
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

  function stable() {
    const moneyMax = ns.getServerMaxMoney(host);
    const moneyStolenPerThread = ns.hackAnalyze(host) * moneyMax;
    const moneyThreshold = moneyMax * moneyThresholdConfig;
    const moneySteal = moneyMax - moneyThreshold;

    const wantHackThreads = Math.floor(moneySteal / moneyStolenPerThread);
    const moneyAfterHack = moneyMax - moneyStolenPerThread * wantHackThreads;
    const hackSecurityGrowth = ns.hackAnalyzeSecurity(wantHackThreads);
    const hackWeakenThreads = Math.ceil(hackSecurityGrowth / 0.05);

    const growMultiplier = 1 + moneySteal / moneyAfterHack;
    const wantGrowThreads = Math.ceil(ns.growthAnalyze(host, growMultiplier));
    const growSecurityGrowth = ns.growthAnalyzeSecurity(wantGrowThreads);
    const wantGrowWeakenThreads = Math.ceil(growSecurityGrowth / 0.05);

    const weakenLength = ns.getWeakenTime(host);
    const growLength = ns.getGrowTime(host);
    const hackLength = ns.getHackTime(host);

    const hackWeakenStart = 0;
    const hackWeakenEnd = hackWeakenStart + weakenLength;
    const hackEnd = hackWeakenEnd - spacing;
    const hackStart = hackEnd - hackLength;
    const growEnd = hackWeakenEnd + spacing;
    const growStart = growEnd - growLength;
    const growWeakenEnd = growEnd + spacing;
    const growWeakenStart = growWeakenEnd - weakenLength;

    let hack = 0,
      grow = 0,
      weaken = 0,
      batch = 0;

    const events: [number, () => void][] = [];

    for (let time = 0; time < growWeakenEnd * 3; time += spacing * 5) {
      events.push([
        time + hackStart,
        () => {
          hack += wantHackThreads;
          batch += 1;
        },
      ]);
      events.push([
        time + hackEnd,
        () => {
          hack -= wantHackThreads;
        },
      ]);
      events.push([
        time + growStart,
        () => {
          grow += wantGrowThreads;
        },
      ]);
      events.push([
        time + growEnd,
        () => {
          grow -= wantGrowThreads;
        },
      ]);
      events.push([
        time + growWeakenStart,
        () => {
          weaken += wantGrowWeakenThreads;
        },
      ]);
      events.push([
        time + growWeakenEnd,
        () => {
          weaken -= wantGrowWeakenThreads;
          batch -= 1;
        },
      ]);
      events.push([
        time + hackWeakenStart,
        () => {
          weaken += hackWeakenThreads;
        },
      ]);
      events.push([
        time + hackWeakenEnd,
        () => {
          weaken -= hackWeakenThreads;
        },
      ]);
    }

    let hackMax = 0,
      growMax = 0,
      weakenMax = 0,
      batchMax = 0,
      threadsMax = 0;
    events.sort((a, b) => a[0] - b[0]);
    for (const [time, fn] of events) {
      fn();
      hackMax = Math.max(hackMax, hack);
      growMax = Math.max(growMax, grow);
      weakenMax = Math.max(weakenMax, weaken);
      batchMax = Math.max(batchMax, batch);
      threadsMax = Math.max(threadsMax, hack + grow + weaken);
    }

    const peakRam = threadsMax * ns.getScriptRam("/bin/payloads/hack.js");
    log.tinfo("Estimate for stable hwgw", {
      host,
      //batchMax,
      hackMax,
      growMax,
      weakenMax,
      threadsMax,
      peakRam: fmt.memory(peakRam),
    });
  }
}

export function autocomplete(data: AutocompleteData, args: string[]): string[] {
  return data.servers;
}
