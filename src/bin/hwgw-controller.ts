/* eslint-disable no-constant-condition */
import { AutocompleteData, NS } from '@ns';

import * as asciichart from 'asciichart';

import { autonuke } from '/autonuke';
import * as colors from '/colors';
import { DB } from '/database';
import { Fmt } from '/fmt';
import { Formulas, stalefish } from '/Formulas';
import HwgwEstimator from '/HwgwEstimator';
import { Log } from '/log';
import { db } from '/services/Database/client';
import { PortRegistryClient } from '/services/PortRegistry/client';
import { SchedulerClient } from '/services/Scheduler/client';
import { HostAffinity, JobId, jobThreads } from '/services/Scheduler/types';

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
        hostAffinity: HostAffinity.mustRunOn({ host: "home" }),
      },
      { nohup: true }
    );
    if (resp.threads === 0) {
      log.terror("Failed to start job", { resp });
    } else {
      log.tinfo("Migrated into Scheduler", { resp });
    }
    return;
  }

  autonuke(ns, host);
  if (!ns.hasRootAccess(host)) {
    log.terror("Need root access to host", { host });
    return;
  }

  if (!skipPrepare) {
    await prepare();
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

  const estimator = new HwgwEstimator(ns);

  let lastPeriodStart = 0;
  const validFrom = ns.getPlayer();
  const validUpTo = ns.getPlayer();
  validUpTo.skills.hacking = Math.ceil(
    validUpTo.skills.hacking * memdb.config.hwgw.hackSkillRangeMult
  );

  const jobs: JobId[] = [];
  const jobFinishedPortNumber = await portRegistryClient.reservePort();
  const jobFinished = new SchedulerClient(ns, log, jobFinishedPortNumber);
  let stalefishResult: { period: number; depth: number } | undefined =
    undefined;
  while (true) {
    // Consume job finished notifications
    while (true) {
      const response = await jobFinished.pollNextJobFinished();
      if (response !== null) {
        jobs.splice(jobs.indexOf(response.jobId), 1);
      } else {
        break;
      }
    }

    if (ns.getPlayer().skills.hacking > validUpTo.skills.hacking) {
      // TODO make this a persistent banner
      log.warn(
        "Hacking skill increased, waiting for jobs to finish and recalculating"
      );

      try {
        let remainingTimeout =
          stalefishResult === undefined
            ? 5000
            : stalefishResult.depth * stalefishResult.period * 2;
        while (jobs.length > 0 && remainingTimeout > 0) {
          log.info("Waiting for jobs to finish", {
            jobs: jobs.length,
            remainingTimeout: fmt.time(remainingTimeout),
          });
          const waitStart = Date.now();
          const response = await jobFinished.pollNextJobFinished({
            timeout: remainingTimeout,
          });
          if (response !== null) {
            jobs.splice(jobs.indexOf(response.jobId), 1);
            remainingTimeout -= Date.now() - waitStart;
          } else {
            break;
          }
        }
      } finally {
        if (jobs.length > 0) {
          log.error("Failed to wait for jobs to finish, killing them", {
            jobs,
          });
          while (jobs.length > 0) {
            const jobId = jobs.shift();
            if (jobId !== undefined) {
              await schedulerClient.killJob(jobId);
            }
          }
        }
      }
      if (shouldWeaken() || (await shouldGrow())) {
        await prepare();
      }

      jobs.splice(0, jobs.length);
      validFrom.skills.hacking = ns.getPlayer().skills.hacking;
      const memdb = await db(ns, log);
      validUpTo.skills.hacking = Math.ceil(
        validUpTo.skills.hacking * memdb.config.hwgw.hackSkillRangeMult
      );
      stalefishResult = undefined;
    }

    let maxDepth = memdb.config.hwgw.maxDepth;
    try {
      const memdb = await db(ns, log);
      const { depth: etaMaxDepth } = await estimator.stableMaxDepth(
        host,
        memdb.config.hwgw.moneyThreshold,
        memdb.config.simpleHack.moneyThreshold
      );
      if (etaMaxDepth < maxDepth) {
        maxDepth = etaMaxDepth;
      }
    } catch (e) {
      // Ignore
    }

    const hack_time = formulas.getHackTime(host);
    const weak_time = formulas.getWeakenTime(host);
    const grow_time = formulas.getGrowTime(host);

    if (stalefishResult === undefined) {
      stalefishResult = stalefish({
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
    }
    const { period, depth } = stalefishResult;

    try {
      await monitor.report({
        t0,
        period,
        depth,
        hackMin: validFrom.skills.hacking,
        hackMax: validUpTo.skills.hacking,
      });
    } catch (e) {
      if (e instanceof Error) {
        log.warn("Monitor failed", { reason: e.message });
      } else {
        log.warn("Monitor failed", { reason: e });
      }
    }

    const periodStart = period * Math.floor(Date.now() / period);
    if (periodStart <= lastPeriodStart) {
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

    // Schedule into the future far enough so that there's time to start up
    let batchStart = periodStart + period;
    while (batchStart + weak_delay_1 < Date.now() + t0) {
      batchStart += period;
      lastPeriodStart += period;
      log.terror("Skipping a batch");
    }
    const hack_start = batchStart + hack_delay;
    const weak_start_1 = batchStart + weak_delay_1;
    const grow_start = batchStart + grow_delay;
    const weak_start_2 = batchStart + weak_delay_2;

    try {
      const { jobId } = await schedulerClient.start(
        {
          script: "/bin/hwgw-batch.js",
          args: [
            host,
            hack_start.toString(),
            weak_start_1.toString(),
            grow_start.toString(),
            weak_start_2.toString(),
          ],
          threads: 1,
          hostAffinity: HostAffinity.preferToRunOn({ host: "home" }),
        },
        {
          finishNotificationPort: jobFinishedPortNumber,
        }
      );
      jobs.push(jobId);
    } catch (e) {
      log.terror("Failed to start batch", { host, e });
    }
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

    if (moneyAvailable < moneyCapacity) {
      log.info("Money needs growing", {
        moneyAvailable: fmt.money(moneyAvailable),
        moneyCapacity: fmt.money(moneyCapacity),
      });
      return true;
    }
    return false;
  }

  async function prepare() {
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
  }
}

export function autocomplete(data: AutocompleteData, args: string[]): string[] {
  if (args.length === 1) {
    return data.servers.filter((server) => server.startsWith(args[0]));
  }
  return [];
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
      hackMin: input.hackMin,
      hackMax: input.hackMax,
    };
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
