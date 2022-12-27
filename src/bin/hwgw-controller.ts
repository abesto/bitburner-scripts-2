import { AutocompleteData, NS } from '@ns';

import * as asciichart from 'asciichart';

import { autonuke } from '/autonuke';
import * as colors from '/colors';
import { DB } from '/database';
import { Fmt } from '/fmt';
import { Formulas } from '/Formulas';
import { Log } from '/log';
import { ServerPort } from '/services/common/ServerPort';
import { db } from '/services/Database/client';
import { PortRegistryClient } from '/services/PortRegistry/client';
import { SchedulerClient } from '/services/Scheduler/client';
import { HostAffinity, JobId, jobThreads } from '/services/Scheduler/types';
import { toSchedulerResponse } from '/services/Scheduler/types/response';

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([
    ["skip-prepare", false],
    ["job", ""],
    ["task", -1],
  ]);
  const posArgs = args._ as string[];
  const host = posArgs[0];
  const server = ns.getServer(host);
  const skipPrepare = args["skip-prepare"] as boolean;

  const log = new Log(ns, "hwgw-controller");

  if (!host) {
    log.terror("Usage: run hwgw-controller.js <host>", { args });
    return;
  }

  const portRegistryClient = new PortRegistryClient(ns, log);
  const schedulerResponsePort = await portRegistryClient.reservePort();
  const schedulerClient = new SchedulerClient(ns, log, schedulerResponsePort);
  const fmt = new Fmt(ns);
  const formulas = new Formulas(ns);

  if (!args.job || args.task < 0) {
    const resp = await schedulerClient.start(
      {
        script: "/bin/hwgw-controller.js",
        args: ns.args.map((arg) => arg.toString()),
        threads: 1,
        hostAffinity: HostAffinity.preferToRunOn({ host: "home" }),
      },
      { nohup: true }
    );
    log.tinfo("Migrated into Scheduler", { jobId: resp.jobId });
    return;
  }

  autonuke(ns, host);

  if (!skipPrepare) {
    log.info("Initial preparation: weaken, grow, weaken");
    while (shouldWeaken() || (await shouldGrow())) {
      const t0 = (await db(ns, log)).config.hwgw.spacing;

      const hack_time = formulas.getHackTime(host);
      const weak_time = formulas.getWeakenTime(host);
      const grow_time = formulas.getGrowTime(host);

      const batchEnd = Date.now() + weak_time + 5 * t0;

      const hack_delay = batchEnd - 4 * t0 - hack_time;
      const weak_delay_1 = batchEnd - 3 * t0 - weak_time;
      const grow_delay = batchEnd - 2 * t0 - grow_time;
      const weak_delay_2 = batchEnd - 1 * t0 - weak_time;

      const { jobId, threads } = await schedulerClient.start({
        script: "/bin/hwgw-batch.js",
        args: [
          host,
          hack_delay.toString(),
          weak_delay_1.toString(),
          grow_delay.toString(),
          weak_delay_2.toString(),
          "--initial",
        ],
        threads: 1,
        hostAffinity: HostAffinity.preferToRunOn({ host: "home" }),
      });
      if (threads === 0) {
        log.info("Failed to start initial batch, sleeping then trying again");
        await ns.sleep(1000);
      }
      log.info("Batch started", { jobId });
      await schedulerClient.waitForJobFinished(jobId);
    }
  } else {
    log.info("Skipping initial preparation");
  }

  log.info("Starting batched hacking");
  ns.tail();
  await ns.sleep(0);
  ns.moveTail(1413, 350);
  ns.resizeTail(1145, 890);
  const monitor = await Monitor.new(ns, log, args.job as JobId, host);
  const memdb = await db(ns, log);
  const t0 = memdb.config.hwgw.spacing;

  let lastPeriodStart = 0;
  const validFrom = ns.getPlayer();
  const validUpTo = ns.getPlayer();
  validUpTo.skills.hacking = Math.ceil(
    validUpTo.skills.hacking * memdb.config.hwgw.hackSkillRangeMult
  );

  const jobs: JobId[] = [];
  const jobFinishedPortNumber = await portRegistryClient.reservePort();
  const jobFinishedPort = new ServerPort(
    ns,
    log,
    jobFinishedPortNumber,
    toSchedulerResponse
  );
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Consume job finished notifications
    while (!jobFinishedPort.empty()) {
      while (!jobFinishedPort.empty()) {
        const response = await jobFinishedPort.read({ timeout: 0 });
        if (response !== null && response.type === "jobFinished") {
          jobs.splice(jobs.indexOf(response.jobId), 1);
        }
      }
    }

    const yolo = !formulas.haveFormulas;
    if (!yolo && ns.getPlayer().skills.hacking > validUpTo.skills.hacking) {
      log.error("Hacking skill increased, killing existing batches");
      for (const jobId of jobs) {
        await schedulerClient.killJob(jobId);
      }
      jobs.splice(0, jobs.length);
      validFrom.skills.hacking = ns.getPlayer().skills.hacking;
      const memdb = await db(ns, log);
      validUpTo.skills.hacking = Math.ceil(
        validFrom.skills.hacking * memdb.config.hwgw.hackSkillRangeMult
      );
    }

    const maxDepth = memdb.config.hwgw.maxDepth;

    const hack_time = formulas.getHackTime(host);
    const weak_time = formulas.getWeakenTime(host);
    const grow_time = formulas.getGrowTime(host);

    const stalefishResult = stalefish({
      weak_time_max: formulas.haveFormulas
        ? ns.formulas.hacking.weakenTime(server, validFrom)
        : weak_time,
      weak_time_min: formulas.haveFormulas
        ? ns.formulas.hacking.weakenTime(server, validUpTo)
        : weak_time,
      grow_time_max: formulas.haveFormulas
        ? ns.formulas.hacking.growTime(server, validFrom)
        : grow_time,
      grow_time_min: formulas.haveFormulas
        ? ns.formulas.hacking.growTime(server, validUpTo)
        : grow_time,
      hack_time_max: formulas.haveFormulas
        ? ns.formulas.hacking.hackTime(server, validFrom)
        : hack_time,
      hack_time_min: formulas.haveFormulas
        ? ns.formulas.hacking.hackTime(server, validUpTo)
        : hack_time,
      t0,
      max_depth: maxDepth <= 0 ? Infinity : maxDepth,
    });
    if (stalefishResult === undefined) {
      log.terror("Stalefish failed", { host, t0 });
      return;
    }
    const period = stalefishResult.period;
    const depth = stalefishResult.depth;

    await monitor.report({
      t0,
      period,
      depth,
      hackMin: validFrom.skills.hacking,
      hackMax: validUpTo.skills.hacking,
      yolo,
    });

    const periodStart = period * Math.floor(Date.now() / period);
    if (periodStart === lastPeriodStart) {
      const nextPeriodStart = periodStart + period;
      const updateResolution = 10;
      const updateInterval = (nextPeriodStart - periodStart) / updateResolution;
      await ns.sleep(updateInterval);
      continue;
    }
    lastPeriodStart = periodStart;

    const hack_delay = depth * period - 4 * t0 - hack_time;
    const weak_delay_1 = depth * period - 3 * t0 - weak_time;
    const grow_delay = depth * period - 2 * t0 - grow_time;
    const weak_delay_2 = depth * period - 1 * t0 - weak_time;

    // Schedule a period into the future to give `hwgw-batch` time to start
    const batchStart = periodStart + period;
    const hack_start = batchStart + hack_delay;
    const weak_start_1 = batchStart + weak_delay_1;
    const grow_start = batchStart + grow_delay;
    const weak_start_2 = batchStart + weak_delay_2;

    const { jobId } = await schedulerClient.start(
      {
        script: "/bin/hwgw-batch.js",
        args: [
          host,
          hack_start.toString(),
          weak_start_1.toString(),
          grow_start.toString(),
          weak_start_2.toString(),
          ...(yolo ? ["--yolo"] : []),
        ],
        threads: 1,
        hostAffinity: HostAffinity.preferToRunOn({ host: "home" }),
      },
      {
        finishNotificationPort: jobFinishedPortNumber,
      }
    );
    jobs.push(jobId);
  }

  function shouldWeaken(): boolean {
    const minSecurity = ns.getServerMinSecurityLevel(host);
    const currentSecurity = ns.getServerSecurityLevel(host);

    if (currentSecurity > minSecurity) {
      log.info("Security needs weakening", { currentSecurity, minSecurity });
      return true;
    }
    return false;
  }

  async function shouldGrow(): Promise<boolean> {
    const moneyAvailable = ns.getServerMoneyAvailable(host);
    const moneyCapacity = ns.getServerMaxMoney(host);
    const threshold =
      (await db(ns, log)).config.hwgw.moneyThreshold * moneyCapacity;

    if (moneyAvailable < threshold) {
      log.info("Money needs growing", {
        moneyAvailable: fmt.money(moneyAvailable),
        threshold: fmt.money(threshold),
      });
      return true;
    }
    return false;
  }
}

export function autocomplete(data: AutocompleteData, args: string[]): string[] {
  if (args.length === 1) {
    return data.servers.filter((server) => server.startsWith(args[0]));
  }
  return [];
}

// As seen on https://discord.com/channels/415207508303544321/944647347625930762/946098412519059526
function stalefish(input: {
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

type ThreadMetrics = [started: number[], running: number[], finished: number[]];
type SimpleMetrics = [min: number[], max: number[], current: number[]];

interface Metrics {
  money: SimpleMetrics;
  security: SimpleMetrics;
  hack: ThreadMetrics;
  grow: ThreadMetrics;
  weaken: ThreadMetrics;
}

class Monitor {
  private readonly fmt: Fmt;
  private metrics: Metrics = {
    money: [[], [], []],
    security: [[], [], []],
    hack: [[], [], []],
    grow: [[], [], []],
    weaken: [[], [], []],
  };
  private readonly last: {
    hack: Map<JobId, number>;
    grow: Map<JobId, number>;
    weaken: Map<JobId, number>;
  } = {
    hack: new Map(),
    grow: new Map(),
    weaken: new Map(),
  };

  constructor(
    private readonly ns: NS,
    private readonly log: Log,
    private readonly jobId: JobId,
    private readonly host: string,
    private readonly maxMoney: number,
    private readonly minSecurity: number,
    private readonly history = 105
  ) {
    this.log = log;
    this.fmt = new Fmt(ns);

    this.metrics.money[0] = new Array(history).fill(0);
    this.metrics.money[1] = new Array(history).fill(maxMoney);

    this.metrics.security[0] = new Array(history).fill(minSecurity);
    this.metrics.security[1] = new Array(history).fill(100);

    this.metrics.hack[0] = new Array(history).fill(0);
    this.metrics.hack[1] = new Array(history).fill(0);
    this.metrics.hack[2] = new Array(history).fill(0);

    this.metrics.grow[0] = new Array(history).fill(0);
    this.metrics.grow[1] = new Array(history).fill(0);
    this.metrics.grow[2] = new Array(history).fill(0);

    this.metrics.weaken[0] = new Array(history).fill(0);
    this.metrics.weaken[1] = new Array(history).fill(0);
    this.metrics.weaken[2] = new Array(history).fill(0);
  }

  static async new(
    ns: NS,
    log: Log,
    jobId: JobId,
    host: string
  ): Promise<Monitor> {
    const maxMoney = ns.getServerMaxMoney(host);
    const minSecurity = ns.getServerMinSecurityLevel(host);
    return new Monitor(ns, log, jobId, host, maxMoney, minSecurity);
  }

  protected recordOne<T, M extends T[]>(metrics: M, value: T): void {
    metrics.push(value);
    if (metrics.length > this.history) {
      metrics.shift();
    }
  }

  protected recordSimple(
    metrics: SimpleMetrics,
    min: number,
    current: number,
    max: number
  ): void {
    this.recordOne(metrics[0], min);
    this.recordOne(metrics[1], max);
    this.recordOne(metrics[2], current);
  }

  protected recordThreads(memdb: DB, kind: "hack" | "grow" | "weaken"): void {
    const last = this.last[kind];
    const current = new Map(
      Object.values(memdb.scheduler.jobs)
        .filter((job) => {
          return (
            job.spec.script === `/bin/payloads/${kind}.js` &&
            job.spec.args[0] === this.host
          );
        })
        .map((job) => {
          return [job.id as JobId, jobThreads(job)];
        })
    );

    let started = 0,
      running = 0,
      finished = 0;
    for (const [jobId, threads] of current) {
      if (!last.has(jobId)) {
        started += threads;
      } else {
        running += threads;
      }
    }
    for (const [jobId, threads] of last) {
      if (!current.has(jobId)) {
        finished += threads;
      }
    }

    this.recordOne(this.metrics[kind][0], started);
    this.recordOne(this.metrics[kind][1], running);
    this.recordOne(this.metrics[kind][2], finished);
    this.last[kind] = current;
  }

  protected async record(): Promise<void> {
    const memdb = await db(this.ns, this.log);
    this.recordSimple(
      this.metrics.money,
      0,
      this.ns.getServerMoneyAvailable(this.host),
      this.maxMoney
    );
    this.recordSimple(
      this.metrics.security,
      this.minSecurity,
      this.ns.getServerSecurityLevel(this.host),
      100
    );
    this.recordThreads(memdb, "hack");
    this.recordThreads(memdb, "grow");
    this.recordThreads(memdb, "weaken");
  }

  currentThreadCount(
    kind: "hack" | "grow" | "weaken",
    state: "started" | "running" | "finished"
  ): number {
    const metrics = this.metrics[kind];
    const series =
      metrics[state === "started" ? 0 : state === "running" ? 1 : 2];
    return series[series.length - 1];
  }

  currentSimpleMetric(metrics: SimpleMetrics): number {
    return metrics[2][metrics[2].length - 1] || 0;
  }

  async report(input: {
    t0: number;
    period: number;
    depth: number;
    hackMin: number;
    hackMax: number;
    yolo: boolean;
  }) {
    await this.record();
    this.ns.clearLog();

    const moneyConfig: asciichart.PlotConfig = {
      format: (x) => this.fmt.money(x).padStart(10, " "),
      height: 6,
      max: this.maxMoney,
      min: 0,
      // 1. `asciichart.white` isn't actually white, it seems to be the default color
      // 2. later series are on top, we want the value on top
      colors: [asciichart.red, asciichart.green, colors.WHITE],
    };

    const securityConfig: asciichart.PlotConfig = {
      format: (x) => this.fmt.float(x).padStart(10, " "),
      height: 6,
      max: 100,
      min: 0,
      colors: [asciichart.green, asciichart.red, colors.WHITE],
    };

    const threadsConfig: asciichart.PlotConfig = {
      height: 3,
      format: (x) => this.fmt.intShort(x).padStart(10, " "),
      colors: [asciichart.green, asciichart.red, asciichart.blue],
    };

    this.log.info("About", { job: this.jobId, targetHost: this.host });
    const kw: { [key: string]: string | number } = {
      t0: this.fmt.timeSeconds(input.t0),
      period: this.fmt.timeSeconds(input.period),
      depth: input.depth,
    };
    if (input.yolo) {
      kw.yolo = "oloy";
    } else {
      kw.hackMin = input.hackMin;
      kw.hackMax = input.hackMax;
    }
    this.log.info("Stalefish", kw);

    this.ns.printf("%s", asciichart.plot(this.metrics.money, moneyConfig));
    this.log.info("money", {
      [colors.red("min")]: this.fmt.money(0),
      [colors.white("current")]: this.fmt.money(
        this.currentSimpleMetric(this.metrics.money)
      ),
      [colors.green("max")]: this.fmt.money(this.maxMoney),
    });
    this.ns.printf("\n");

    this.ns.printf(
      "%s",
      asciichart.plot(this.metrics.security, securityConfig)
    );
    this.log.info("security", {
      [colors.green("min")]: this.minSecurity,
      [colors.white("current")]: this.fmt.float(
        this.currentSimpleMetric(this.metrics.security)
      ),
      [colors.red("max")]: 100,
    });
    this.ns.printf("\n");

    for (const kind of ["hack", "weaken", "grow"] as const) {
      //this.log.tdebug("plotting", { kind, metrics: this.metrics[kind] });
      this.ns.printf(
        "%s",
        asciichart.plot(
          [this.metrics[kind][0], this.metrics[kind][2]],
          threadsConfig
        )
      );
      this.log.info(kind, {
        [colors.green("started")]: this.currentThreadCount(kind, "started"),
        [colors.black("running")]: this.currentThreadCount(kind, "running"),
        [colors.red("finished")]: this.currentThreadCount(kind, "finished"),
      });
      this.ns.printf("\n");
    }

    this.ns.printf(
      "%s",
      asciichart.plot(
        [this.metrics.hack[1], this.metrics.grow[1], this.metrics.weaken[1]],
        { ...threadsConfig, height: 6 }
      )
    );
    this.log.info("running", {
      [colors.green("hack")]: this.currentThreadCount("hack", "running"),
      [colors.red("grow")]: this.currentThreadCount("grow", "running"),
      [colors.blue("weaken")]: this.currentThreadCount("weaken", "running"),
    });
  }
}
