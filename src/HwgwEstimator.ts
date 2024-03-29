import { NS, Server } from "@ns";

import { Log } from "/log";

import { Formulas, stalefish } from "./Formulas";
import { withClient } from "./services/client_factory";
import { db } from "./services/Database/client";
import { SchedulerClient } from "./services/Scheduler/client";

export default class HwgwEstimator {
  private readonly log: Log;

  constructor(private readonly ns: NS) {
    this.log = new Log(ns, "HwgwEstimator");
  }

  async initial(server: Server): Promise<{
    wantGrowThreads: number;
    wantGrowWeakenThreads: number;
    ramRequirement: number;
    batchLen: number;
  }> {
    const memdb = await db(this.ns, this.log);
    const spacing = memdb.config.hwgw.spacing;

    const moneyMax = server.moneyMax || 0;

    const growMultiplier = moneyMax / (server.moneyAvailable || 0);
    const wantGrowThreads = Math.ceil(
      this.ns.growthAnalyze(server.hostname, growMultiplier)
    );
    const growSecurityGrowth = this.ns.growthAnalyzeSecurity(wantGrowThreads);
    const wantGrowWeakenThreads = Math.ceil(growSecurityGrowth / 0.05);

    const weakenLength = this.ns.getWeakenTime(server.hostname);

    const ramRequirement =
      wantGrowThreads * this.ns.getScriptRam("bin/payloads/grow.js") +
      wantGrowWeakenThreads * this.ns.getScriptRam("bin/payloads/weaken.js");

    const batchLen = weakenLength + spacing * 2;

    return {
      wantGrowThreads,
      wantGrowWeakenThreads,
      ramRequirement: ramRequirement,
      batchLen: batchLen,
    };
  }

  async stableMaxDepth(
    server: Server,
    hwgwMoneyThresholdConfig: number,
    simpleMoneyThresholdConfig: number,
    spacingConfig: number | undefined = undefined
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

    const formulas = new Formulas(this.ns);
    const hackThreads = formulas.hacksFromToMoneyRatio(
      server,
      1,
      hwgwMoneyThresholdConfig
    );
    const hackWeakenThreads = formulas.weakenAfterHacks(hackThreads);

    const moneyMax = server.moneyMax || 0;
    const moneyStolenPerThread =
      this.ns.hackAnalyze(server.hostname) * moneyMax;
    const moneyAfterHack = moneyMax - moneyStolenPerThread * hackThreads;
    const growThreads = formulas.growthFromToMoneyRatio(
      server,
      moneyAfterHack / moneyMax,
      1
    );
    const growWeakenThreads = formulas.weakenAfterGrows(growThreads);

    const weak_time = formulas.getWeakenTime(server);
    const grow_time = formulas.getGrowTime(server);
    const hack_time = formulas.getHackTime(server);

    const cache = {
      spacingConfig,
      hackThreads,
      hackWeakenThreads,
      moneyStolenPerThread,
      growThreads,
      growWeakenThreads,
      weak_time,
      grow_time,
      hack_time,
    };

    let maxDepth = 1;
    let stable = await this.stable(
      server,
      hwgwMoneyThresholdConfig,
      maxDepth,
      cache
    );
    while (stable.peakRam < totalMem && maxDepth < 50) {
      if (stable.peakRam === 0) {
        if (maxDepth > 1) {
          stable = await this.stable(
            server,
            hwgwMoneyThresholdConfig,
            maxDepth - 1,
            cache
          );
        }
        break;
      }
      stable = await this.stable(
        server,
        hwgwMoneyThresholdConfig,
        ++maxDepth,
        cache
      );
    }

    let period = stable.period;
    if (stable.peakRam === 0 && stable.depth === 1) {
      // We're in sequential, simple hacking mode
      const formulas = new Formulas(this.ns);
      period =
        formulas.getGrowTime(server) +
        formulas.getWeakenTime(server) +
        formulas.getHackTime(server);
    }
    const moneyPerPeriod =
      (server.moneyMax || 0) * (1 - simpleMoneyThresholdConfig);
    const moneyPerSec = moneyPerPeriod / (period / 1000);

    return { ...stable, moneyPerSec };
  }

  async stable(
    server: Server,
    moneyThresholdConfig: number,
    maxDepthConfig: number,
    {
      spacingConfig,
      hackThreads,
      hackWeakenThreads,
      moneyStolenPerThread,
      growThreads,
      growWeakenThreads,
      weak_time,
      grow_time,
      hack_time,
    }: {
      spacingConfig?: number;
      hackThreads?: number;
      hackWeakenThreads?: number;
      moneyStolenPerThread?: number;
      growThreads?: number;
      growWeakenThreads?: number;
      weak_time?: number;
      grow_time?: number;
      hack_time?: number;
    } = {}
  ): Promise<{
    hackMax: number;
    growMax: number;
    weakenMax: number;
    threadsMax: number;
    peakRam: number;
    period: number;
    depth: number;
  }> {
    const t0 =
      spacingConfig || (await db(this.ns, this.log)).config.hwgw.spacing;
    const formulas = new Formulas(this.ns);

    hackThreads ??= formulas.hacksFromToMoneyRatio(
      server,
      1,
      moneyThresholdConfig
    );
    hackWeakenThreads ??= formulas.weakenAfterHacks(hackThreads);

    const moneyMax = server.moneyMax || 0;
    moneyStolenPerThread ??= this.ns.hackAnalyze(server.hostname) * moneyMax;
    const moneyAfterHack = moneyMax - moneyStolenPerThread * hackThreads;
    growThreads ??= formulas.growthFromToMoneyRatio(
      server,
      moneyAfterHack / moneyMax,
      1
    );
    growWeakenThreads ??= formulas.weakenAfterGrows(growThreads);

    weak_time ??= formulas.getWeakenTime(server);
    grow_time ??= formulas.getGrowTime(server);
    hack_time ??= formulas.getHackTime(server);

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

    const peakRam = threadsMax * this.ns.getScriptRam("bin/payloads/hack.js");
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
