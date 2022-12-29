import { NS } from '@ns';

import { Log } from '/log';

import { Formulas, stalefish } from './Formulas';
import { withClient } from './services/client_factory';
import { db } from './services/Database/client';
import { SchedulerClient } from './services/Scheduler/client';

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

  async stableMaxDepth(
    host: string,
    hwgwMoneyThresholdConfig: number,
    simpleMoneyThresholdConfig: number
  ): Promise<{
    hackMax: number;
    growMax: number;
    weakenMax: number;
    threadsMax: number;
    peakRam: number;
    period: number;
    depth: number;
    moneyPerSec: number;
  }> {
    const { capacity } = await withClient(
      SchedulerClient,
      this.ns,
      this.log,
      (client) => client.capacity()
    );
    // Leave headroom for infrastructure
    const totalMem = capacity.reduce((acc, cur) => acc + cur.totalMem, 0) - 22;

    let maxDepth = 1;
    let stable = await this.stable(host, hwgwMoneyThresholdConfig, maxDepth);
    while (stable.peakRam < totalMem && maxDepth < 50) {
      if (stable.peakRam === 0) {
        if (maxDepth > 1) {
          stable = await this.stable(
            host,
            hwgwMoneyThresholdConfig,
            maxDepth - 1
          );
        }
        break;
      }
      stable = await this.stable(host, hwgwMoneyThresholdConfig, ++maxDepth);
    }

    let period = stable.period;
    if (stable.peakRam === 0 && stable.depth === 1) {
      // We're in sequential, simple hacking mode
      const formulas = new Formulas(this.ns);
      period =
        formulas.getGrowTime(host) +
        formulas.getWeakenTime(host) +
        formulas.getHackTime(host);
    }
    const moneyPerPeriod =
      this.ns.getServerMaxMoney(host) * (1 - simpleMoneyThresholdConfig);
    const moneyPerSec = moneyPerPeriod / (period / 1000);

    return { ...stable, moneyPerSec };
  }

  async stable(
    host: string,
    moneyThresholdConfig: number,
    maxDepthConfig: number
  ): Promise<{
    hackMax: number;
    growMax: number;
    weakenMax: number;
    threadsMax: number;
    peakRam: number;
    period: number;
    depth: number;
  }> {
    const memdb = await db(this.ns, this.log);
    const formulas = new Formulas(this.ns);

    const hackThreads = formulas.hacksFromToMoneyRatio(
      host,
      1,
      moneyThresholdConfig
    );
    const hackWeakenThreads = formulas.weakenAfterHacks(hackThreads);

    const moneyMax = this.ns.getServerMaxMoney(host);
    const moneyStolenPerThread = this.ns.hackAnalyze(host) * moneyMax;
    const moneyAfterHack =
      this.ns.getServerMaxMoney(host) - moneyStolenPerThread * hackThreads;
    const growThreads = formulas.growthFromToMoneyRatio(
      host,
      moneyAfterHack / moneyMax,
      1
    );
    const growWeakenThreads = formulas.weakenAfterGrows(growThreads);

    const weak_time = formulas.getWeakenTime(host);
    const grow_time = formulas.getGrowTime(host);
    const hack_time = formulas.getHackTime(host);
    const t0 = memdb.config.hwgw.spacing;

    const stalefishResult = stalefish({
      grow_time_max: grow_time,
      hack_time_max: hack_time,
      weak_time_max: weak_time,

      grow_time_min: grow_time,
      hack_time_min: hack_time,
      weak_time_min: weak_time,

      t0,
      max_depth: maxDepthConfig,
    });

    if (stalefishResult === undefined) {
      throw new Error("Stalefish failed");
    }
    const { period, depth } = stalefishResult;
    const hack_delay = depth * period - 4 * t0 - hack_time;
    const weak_delay_1 = depth * period - 3 * t0 - weak_time;
    const grow_delay = depth * period - 2 * t0 - grow_time;
    const weak_delay_2 = depth * period - 1 * t0 - weak_time;

    const threads = {
      hack: 0,
      grow: 0,
      weak: 0,
    };

    const events: [number, () => void][] = [];

    const record = (
      kind: keyof typeof threads,
      nPeriod: number,
      delay: number,
      length: number,
      threadCount: number
    ) => {
      const start = nPeriod * period + delay;
      events.push([
        start,
        () => {
          threads[kind] += threadCount;
        },
      ]);
      events.push([
        start + length,
        () => {
          threads[kind] -= threadCount;
        },
      ]);
    };

    for (let nPeriod = 0; nPeriod < depth; nPeriod++) {
      record("hack", nPeriod, hack_delay, hack_time, hackThreads);
      record("weak", nPeriod, weak_delay_1, weak_time, hackWeakenThreads);
      record("weak", nPeriod, weak_delay_2, weak_time, growWeakenThreads);
      record("grow", nPeriod, grow_delay, grow_time, growThreads);
    }

    let hackMax = 0,
      growMax = 0,
      weakenMax = 0,
      threadsMax = 0;
    events.sort((a, b) => a[0] - b[0]);
    for (const [, fn] of events) {
      fn();
      hackMax = Math.max(hackMax, threads.hack);
      growMax = Math.max(growMax, threads.grow);
      weakenMax = Math.max(weakenMax, threads.weak);
      threadsMax = Math.max(
        threadsMax,
        threads.hack + threads.grow + threads.weak
      );
    }

    const peakRam = threadsMax * this.ns.getScriptRam("/bin/payloads/hack.js");
    return {
      hackMax,
      growMax,
      weakenMax,
      threadsMax,
      peakRam: peakRam,
      period,
      depth,
    };
  }
}
