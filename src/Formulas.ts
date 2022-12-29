import { NS } from '@ns';

export class Formulas {
  private lastFormulasCheck = 0;
  private _haveFormulas = false;

  constructor(private ns: NS) {}

  get haveFormulas(): boolean {
    if (Date.now() - this.lastFormulasCheck > 1000) {
      this.lastFormulasCheck = Date.now();
      this._haveFormulas = this.ns.fileExists("Formulas.exe");
    }
    return this._haveFormulas;
  }

  moneyRatio(server: string): number {
    return (
      this.ns.getServerMoneyAvailable(server) /
      this.ns.getServerMaxMoney(server)
    );
  }

  growthForMoneyMultiplier(
    server: string,
    targetMultiplier: number,
    atSecurity: number | null = null
  ): number {
    let threads = Math.ceil(this.ns.growthAnalyze(server, targetMultiplier));
    if (this.haveFormulas) {
      const serverObj = this.ns.getServer(server);
      const player = this.ns.getPlayer();
      serverObj.hackDifficulty = atSecurity || serverObj.minDifficulty;
      while (
        this.ns.formulas.hacking.growPercent(serverObj, threads, player) <
        targetMultiplier
      ) {
        threads *= 1.01;
      }
    }
    return Math.max(0, Math.ceil(threads));
  }

  growthToTargetMoneyRatio(server: string, targetMoneyRatio: number): number {
    const currentMoneyRatio = this.moneyRatio(server);
    const targetMultiplier = targetMoneyRatio / currentMoneyRatio;
    return this.growthForMoneyMultiplier(server, targetMultiplier);
  }

  growthFromToMoneyRatio(
    server: string,
    from: number,
    to: number,
    atSecurity: number | null = null
  ): number {
    return this.growthForMoneyMultiplier(
      server,
      Math.max(1, to / from),
      atSecurity
    );
  }

  almostEquals(a: number, b: number, epsilon: number): boolean {
    return Math.abs(a - b) < epsilon;
  }

  getBaseLog(base: number, x: number): number {
    return Math.log(x) / Math.log(base);
  }

  hacksFromToMoneyRatio(server: string, from: number, to: number): number {
    if (from < to) {
      return 0;
    }
    const targetPercent = from - to;
    if (this.haveFormulas) {
      const serverObj = this.ns.getServer(server);
      serverObj.hackDifficulty = serverObj.minDifficulty;
      const hackPercent = this.ns.formulas.hacking.hackPercent(
        serverObj,
        this.ns.getPlayer()
      );
      return Math.ceil(targetPercent / hackPercent);
      //return Math.ceil(getBaseLog(1 - hackPercent, targetPercent));
    }
    const targetMoneyStolen = this.ns.getServerMaxMoney(server) * targetPercent;
    const threads = Math.floor(
      this.ns.hackAnalyzeThreads(server, targetMoneyStolen)
    );
    return Math.max(0, threads);
  }

  weakenForSecurityDecrease(security: number): number {
    // This makes the bold assumption that weakens are linear
    let threads = Math.ceil(security / this.ns.weakenAnalyze(1));
    // It seems to not work very well, and I can't find a much better way, so...
    while (this.ns.weakenAnalyze(threads) < security) {
      threads++;
    }
    return Math.max(0, Math.ceil(threads));
  }

  weakenToMinimum(server: string): number {
    return this.weakenForSecurityDecrease(
      this.ns.getServerSecurityLevel(server) -
        this.ns.getServerMinSecurityLevel(server)
    );
  }

  weakenAfterHacks(hacks: number): number {
    const security = this.ns.hackAnalyzeSecurity(hacks);
    return this.weakenForSecurityDecrease(security);
  }

  weakenAfterGrows(grows: number): number {
    const security = this.ns.growthAnalyzeSecurity(grows);
    return this.weakenForSecurityDecrease(security);
  }

  getWeakenTime(server: string): number {
    if (this.haveFormulas) {
      return this.ns.formulas.hacking.weakenTime(
        this.ns.getServer(server),
        this.ns.getPlayer()
      );
    }
    return this.ns.getWeakenTime(server);
  }

  getHackTime(server: string): number {
    if (this.haveFormulas) {
      const serverObj = this.ns.getServer(server);
      serverObj.hackDifficulty = serverObj.minDifficulty;
      return this.ns.formulas.hacking.hackTime(serverObj, this.ns.getPlayer());
    }
    return this.ns.getHackTime(server);
  }

  getGrowTime(server: string): number {
    if (this.haveFormulas) {
      const serverObj = this.ns.getServer(server);
      serverObj.hackDifficulty = serverObj.minDifficulty;
      return this.ns.formulas.hacking.growTime(serverObj, this.ns.getPlayer());
    }
    return this.ns.getGrowTime(server);
  }

  estimateStableThreadCount(
    server: string,
    targetMoneyRatio: number,
    tickLength: number
  ): number {
    // This is a VERY rough estimate, but it's good enough for skipping too-small servers
    const hacksPerBatch = this.hacksFromToMoneyRatio(
      server,
      1,
      targetMoneyRatio
    );
    const growsPerBatch = this.growthFromToMoneyRatio(
      server,
      targetMoneyRatio,
      1
    );
    const weakensPerBatch =
      this.weakenAfterGrows(growsPerBatch) +
      this.weakenAfterHacks(hacksPerBatch);
    const concurrentBatches = this.getWeakenTime(server) / tickLength;
    return Math.ceil(
      (hacksPerBatch + growsPerBatch + weakensPerBatch) * concurrentBatches
    );
  }
}

// As seen on https://discord.com/channels/415207508303544321/944647347625930762/946098412519059526
export function stalefish(input: {
  weak_time_min: number;
  weak_time_max: number;
  grow_time_min: number;
  grow_time_max: number;
  hack_time_min: number;
  hack_time_max: number;
  t0: number;
  max_depth: number;
}): { period: number; depth: number } | undefined {
  const {
    weak_time_min,
    weak_time_max,
    grow_time_min,
    grow_time_max,
    hack_time_min,
    hack_time_max,
    t0,
    max_depth,
  } = input;
  let period, depth;
  const kW_max = Math.min(
    Math.floor(1 + (weak_time_max - 4 * t0) / (8 * t0)),
    max_depth
  );
  schedule: for (let kW = kW_max; kW >= 1; --kW) {
    const t_min_W = (weak_time_max + 4 * t0) / kW;
    const t_max_W = (weak_time_min - 4 * t0) / (kW - 1);
    const kG_min = Math.ceil(Math.max((kW - 1) * 0.8, 1));
    const kG_max = Math.floor(1 + kW * 0.8);
    for (let kG = kG_max; kG >= kG_min; --kG) {
      const t_min_G = (grow_time_max + 3 * t0) / kG;
      const t_max_G = (grow_time_min - 3 * t0) / (kG - 1);
      const kH_min = Math.ceil(Math.max((kW - 1) * 0.25, (kG - 1) * 0.3125, 1));
      const kH_max = Math.floor(Math.min(1 + kW * 0.25, 1 + kG * 0.3125));
      for (let kH = kH_max; kH >= kH_min; --kH) {
        const t_min_H = (hack_time_max + 5 * t0) / kH;
        const t_max_H = (hack_time_min - 1 * t0) / (kH - 1);
        const t_min = Math.max(t_min_H, t_min_G, t_min_W);
        const t_max = Math.min(t_max_H, t_max_G, t_max_W);
        if (t_min <= t_max) {
          period = t_min;
          depth = kW;
          break schedule;
        }
      }
    }
  }
  if (period === undefined || depth === undefined) return undefined;
  return { period, depth };
}
