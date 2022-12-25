import { NS } from '@ns';

import { db } from '/database';
import { Log } from '/log';

export default class HwgwEstimator {
  private readonly log: Log;

  constructor(private readonly ns: NS) {
    this.log = new Log(ns, "HwgwEstimator");
  }

  async initial(host: string): Promise<{
    wantGrowThreads: number;
    wantGrowWeakenThreads: number;
    ramRequirement: number;
    batchLen: number;
  }> {
    const memdb = await db(this.ns, this.log);
    const spacing = memdb.config.hwgw.spacing;

    const moneyMax = this.ns.getServerMaxMoney(host);

    const growMultiplier = moneyMax / this.ns.getServerMoneyAvailable(host);
    const wantGrowThreads = Math.ceil(
      this.ns.growthAnalyze(host, growMultiplier)
    );
    const growSecurityGrowth = this.ns.growthAnalyzeSecurity(wantGrowThreads);
    const wantGrowWeakenThreads = Math.ceil(growSecurityGrowth / 0.05);

    const weakenLength = this.ns.getWeakenTime(host);

    const ramRequirement =
      wantGrowThreads * this.ns.getScriptRam("/bin/payloads/grow.js") +
      wantGrowWeakenThreads * this.ns.getScriptRam("/bin/payloads/weaken.js");

    const batchLen = weakenLength + spacing * 2;

    return {
      wantGrowThreads,
      wantGrowWeakenThreads,
      ramRequirement: ramRequirement,
      batchLen: batchLen,
    };
  }

  async stable(
    host: string,
    moneyThresholdConfig_ = 0
  ): Promise<{
    hackMax: number;
    growMax: number;
    weakenMax: number;
    threadsMax: number;
    peakRam: number;
  }> {
    const memdb = await db(this.ns, this.log);
    const moneyThresholdConfig =
      moneyThresholdConfig_ || memdb.config.hwgw.moneyThreshold;
    const spacing = memdb.config.hwgw.spacing;

    const moneyMax = this.ns.getServerMaxMoney(host);
    const moneyStolenPerThread = this.ns.hackAnalyze(host) * moneyMax;
    const moneyThreshold = moneyMax * moneyThresholdConfig;
    const moneySteal = moneyMax - moneyThreshold;

    const wantHackThreads = Math.floor(moneySteal / moneyStolenPerThread);
    const moneyAfterHack = moneyMax - moneyStolenPerThread * wantHackThreads;
    const hackSecurityGrowth = this.ns.hackAnalyzeSecurity(wantHackThreads);
    const hackWeakenThreads = Math.ceil(hackSecurityGrowth / 0.05);

    const growMultiplier = 1 + moneySteal / moneyAfterHack;
    const wantGrowThreads = Math.ceil(
      this.ns.growthAnalyze(host, growMultiplier)
    );
    const growSecurityGrowth = this.ns.growthAnalyzeSecurity(wantGrowThreads);
    const wantGrowWeakenThreads = Math.ceil(growSecurityGrowth / 0.05);

    const weakenLength = this.ns.getWeakenTime(host);
    const growLength = this.ns.getGrowTime(host);
    const hackLength = this.ns.getHackTime(host);

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

    const peakRam = threadsMax * this.ns.getScriptRam("/bin/payloads/hack.js");
    return {
      //batchMax,
      hackMax,
      growMax,
      weakenMax,
      threadsMax,
      peakRam: peakRam,
    };
  }
}
