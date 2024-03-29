/* eslint-disable no-constant-condition */
import { AutocompleteData, NS, Player, Server } from "@ns";

import { autonuke } from "/autonuke";
import { DB } from "/database";
import { Fmt } from "/fmt";
import { Formulas, stalefish } from "/Formulas";
import HwgwEstimator from "/HwgwEstimator";
import { Log } from "/log";
import { db } from "/services/Database/client";
import { PortRegistryClient } from "/services/PortRegistry/client";
import { SchedulerClient } from "/services/Scheduler/client";
import { HostAffinity, JobId } from "/services/Scheduler/types";

class HwgwController {
  private server: Server;
  private readonly fmt: Fmt;
  private readonly formulas: Formulas;
  private readonly estimator: HwgwEstimator;
  private readonly jobs: JobId[] = [];
  private stalefishResult: { period: number; depth: number } | undefined;

  constructor(
    private readonly ns: NS,
    private readonly log: Log,
    hostName: string,
    private readonly schedulerClient: SchedulerClient,
    private readonly jobsFinishedPort: number,
    private readonly jobsFinished: SchedulerClient
  ) {
    this.fmt = new Fmt(ns);
    this.server = ns.getServer(hostName);
    this.formulas = new Formulas(ns);
    this.estimator = new HwgwEstimator(ns);
  }

  static async new(
    ns: NS,
    log: Log,
    hostName: string
  ): Promise<HwgwController> {
    const portRegistryClient = new PortRegistryClient(ns, log);

    const schedulerResponsePort = await portRegistryClient.reservePort();
    const schedulerClient = new SchedulerClient(ns, log, schedulerResponsePort);

    const jobsFinishedPort = await portRegistryClient.reservePort();
    const jobsFinished = new SchedulerClient(ns, log, jobsFinishedPort);

    return new HwgwController(
      ns,
      log,
      hostName,
      schedulerClient,
      jobsFinishedPort,
      jobsFinished
    );
  }

  async startMonitor() {
    await this.schedulerClient.start(
      {
        script: "bin/hwgw-monitor.js",
        args: [this.server.hostname],
        threads: 1,
      },
      {
        finishNotificationPort: null,
      }
    );
  }

  shouldWeaken(): boolean {
    const minSecurity = this.server.minDifficulty || 0;
    const currentSecurity =
      this.ns.getServer(this.server.hostname).hackDifficulty || 0;

    if (currentSecurity > minSecurity) {
      this.log.info("Security needs weakening", {
        currentSecurity,
        minSecurity,
      });
      return true;
    }
    return false;
  }

  async shouldGrow(): Promise<boolean> {
    const moneyAvailable = this.server.moneyAvailable || 0;
    const moneyCapacity = this.server.moneyMax || 0;

    if (moneyAvailable < moneyCapacity) {
      this.log.info("Money needs growing", {
        moneyAvailable: this.fmt.money(moneyAvailable),
        moneyCapacity: this.fmt.money(moneyCapacity),
      });
      return true;
    }
    return false;
  }

  async needsPreparation(): Promise<boolean> {
    return this.shouldWeaken() || (await this.shouldGrow());
  }

  async prepare() {
    this.log.info("Initial preparation: weaken, grow, weaken");
    this.server = this.ns.getServer(this.server.hostname);

    while (await this.needsPreparation()) {
      this.server = this.ns.getServer(this.server.hostname);
      const t0 = (await db(this.ns, this.log)).config.hwgw.spacing;

      const hack_time = this.formulas.getHackTime(this.server);
      const weak_time = this.formulas.getWeakenTime(this.server);
      const grow_time = this.formulas.getGrowTime(this.server);

      const batchEnd = Date.now() + weak_time + 5 * t0;

      const hack_delay = batchEnd - 4 * t0 - hack_time;
      const weak_delay_1 = batchEnd - 3 * t0 - weak_time;
      const grow_delay = batchEnd - 2 * t0 - grow_time;
      const weak_delay_2 = batchEnd - 1 * t0 - weak_time;

      const { jobId, threads } = await this.schedulerClient.start({
        script: "bin/hwgw-batch.js",
        args: [
          this.server.hostname,
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
        this.log.info(
          "Failed to start initial batch, sleeping then trying again"
        );
        await this.ns.sleep(1000);
      }
      this.log.info("Batch started", { jobId });
      await this.schedulerClient.waitForJobFinished(jobId);
    }
  }

  async positionTail() {
    this.ns.tail();
    await this.ns.sleep(0);
    this.ns.resizeTail(930, 345);
    this.ns.moveTail(1413, 0);
  }

  async run() {
    const memdb = await db(this.ns, this.log);
    const t0 = memdb.config.hwgw.spacing;

    let lastPeriodStart = 0;
    const validFrom = this.ns.getPlayer();
    const validUpTo = this.ns.getPlayer();
    validUpTo.skills.hacking = Math.ceil(
      validUpTo.skills.hacking * memdb.config.hwgw.hackSkillRangeMult
    );

    while (true) {
      await this.consumeFinishedJobs();
      this.server = this.ns.getServer(this.server.hostname);

      if (this.ns.getPlayer().skills.hacking > validUpTo.skills.hacking) {
        this.log.warn(
          "Hacking skill increased, waiting for jobs to finish and restarting"
        );
        await this.waitForAllJobsToFinish();
        return;
      }

      const maxDepth = await this.calculateMaxDepth(memdb);
      const hack_time = this.formulas.getHackTime(this.server);
      const weak_time = this.formulas.getWeakenTime(this.server);
      const grow_time = this.formulas.getGrowTime(this.server);

      this.recalculateStalefish(
        weak_time,
        grow_time,
        hack_time,
        maxDepth,
        validFrom,
        validUpTo,
        t0
      );
      if (this.stalefishResult === undefined) {
        this.log.terror("Stalefish failed", { host: this.server.hostname, t0 });
        throw new Error("Stalefish failed");
      }
      const { period, depth } = this.stalefishResult;

      const periodStart = period * Math.floor(Date.now() / period);
      if (periodStart <= lastPeriodStart) {
        const nextPeriodStart = periodStart + period;
        await this.ns.sleep(Date.now() - nextPeriodStart);
        continue;
      }
      lastPeriodStart = periodStart;
      lastPeriodStart = await this.scheduleBatch(
        depth,
        period,
        hack_time,
        weak_time,
        grow_time,
        periodStart,
        t0,
        lastPeriodStart
      );
    }
  }

  async consumeFinishedJobs() {
    while (true) {
      const response = await this.jobsFinished.pollNextJobFinished();
      if (response !== null) {
        this.jobs.splice(this.jobs.indexOf(response.jobId), 1);
      } else {
        break;
      }
    }
  }

  async waitForAllJobsToFinish() {
    try {
      let remainingTimeout =
        this.stalefishResult === undefined
          ? 5000
          : this.stalefishResult.depth * this.stalefishResult.period * 2;
      while (this.jobs.length > 0 && remainingTimeout > 0) {
        this.log.info("Waiting for jobs to finish", {
          jobs: this.jobs.length,
          remainingTimeout: this.fmt.time(remainingTimeout),
        });
        const waitStart = Date.now();
        const response = await this.jobsFinished.pollNextJobFinished({
          timeout: remainingTimeout,
        });
        if (response !== null) {
          this.jobs.splice(this.jobs.indexOf(response.jobId), 1);
          remainingTimeout -= Date.now() - waitStart;
        } else {
          break;
        }
      }
    } finally {
      if (this.jobs.length > 0) {
        this.log.error("Failed to wait for jobs to finish, killing them", {
          jobs: this.jobs,
        });
        while (this.jobs.length > 0) {
          const jobId = this.jobs.shift();
          if (jobId !== undefined) {
            await this.schedulerClient.killJob(jobId);
          }
        }
      }
    }
  }

  async calculateMaxDepth(oldMemdb: DB): Promise<number> {
    let maxDepth = oldMemdb.config.hwgw.maxDepth;
    try {
      const newMemdb = await db(this.ns, this.log);
      const { depth: etaMaxDepth } = await this.estimator.stableMaxDepth(
        this.server,
        newMemdb.config.hwgw.moneyThreshold,
        newMemdb.config.simpleHack.moneyThreshold
      );
      if (etaMaxDepth < maxDepth) {
        maxDepth = etaMaxDepth;
      }
    } catch (e) {
      // Ignore
    }
    return maxDepth;
  }

  recalculateStalefish(
    weak_time: number,
    grow_time: number,
    hack_time: number,
    maxDepth: number,
    validFrom: Player,
    validUpTo: Player,
    t0: number
  ) {
    if (this.stalefishResult === undefined) {
      this.stalefishResult = stalefish({
        weak_time_max: this.formulas.haveFormulas
          ? this.ns.formulas.hacking.weakenTime(this.server, validFrom)
          : weak_time,
        weak_time_min: this.formulas.haveFormulas
          ? this.ns.formulas.hacking.weakenTime(this.server, validUpTo)
          : weak_time,
        grow_time_max: this.formulas.haveFormulas
          ? this.ns.formulas.hacking.growTime(this.server, validFrom)
          : grow_time,
        grow_time_min: this.formulas.haveFormulas
          ? this.ns.formulas.hacking.growTime(this.server, validUpTo)
          : grow_time,
        hack_time_max: this.formulas.haveFormulas
          ? this.ns.formulas.hacking.hackTime(this.server, validFrom)
          : hack_time,
        hack_time_min: this.formulas.haveFormulas
          ? this.ns.formulas.hacking.hackTime(this.server, validUpTo)
          : hack_time,
        t0,
        max_depth: maxDepth <= 0 ? Infinity : maxDepth,
      });
      this.log.info("Stalefish result", {
        host: this.server.hostname,
        stalefishResult: this.stalefishResult,
      });
    }
  }

  async scheduleBatch(
    depth: number,
    period: number,
    hack_time: number,
    weak_time: number,
    grow_time: number,
    periodStart: number,
    t0: number,
    lastPeriodStart: number
  ): Promise<number> {
    const hack_delay = depth * period - 4 * t0 - hack_time;
    const weak_delay_1 = depth * period - 3 * t0 - weak_time;
    const grow_delay = depth * period - 2 * t0 - grow_time;
    const weak_delay_2 = depth * period - 1 * t0 - weak_time;

    // Schedule into the future far enough so that there's time to start up
    let batchStart = periodStart + period;
    while (batchStart + weak_delay_1 < Date.now() + t0) {
      batchStart += period;
      lastPeriodStart += period;
      this.log.terror("Skipping a batch");
    }
    const hack_start = batchStart + hack_delay;
    const weak_start_1 = batchStart + weak_delay_1;
    const grow_start = batchStart + grow_delay;
    const weak_start_2 = batchStart + weak_delay_2;

    try {
      const { jobId } = await this.schedulerClient.start(
        {
          script: "bin/hwgw-batch.js",
          args: [
            this.server.hostname,
            hack_start.toString(),
            weak_start_1.toString(),
            grow_start.toString(),
            weak_start_2.toString(),
          ],
          threads: 1,
          hostAffinity: HostAffinity.preferToRunOn({ host: "home" }),
        },
        {
          finishNotificationPort: this.jobsFinishedPort,
        }
      );
      this.jobs.push(jobId);
    } catch (e) {
      this.log.terror("Failed to start batch", {
        host: this.server.hostname,
        e,
      });
    }
    return lastPeriodStart;
  }
}

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([
    ["skip-prepare", false],
    ["job", ""],
    ["task", -1],
  ]);
  const posArgs = args._ as string[];
  const host = posArgs[0];
  const skipPrepare = args["skip-prepare"] as boolean;
  const job = args.job as string;
  const task = args.task as number;
  const log = new Log(ns, "hwgw-controller");

  if (!host || job === undefined || task === undefined) {
    log.terror(
      "Usage: run hwgw-controller.js <host> --job <job> --task <task>",
      { args }
    );
    return;
  }

  const server = ns.getServer(host);
  if (!autonuke(ns, server)) {
    log.terror("Need root access to host", { host });
    return;
  }

  const prepareHwgwController = await HwgwController.new(ns, log, host);
  await prepareHwgwController.startMonitor();
  if (!skipPrepare) {
    await prepareHwgwController.positionTail();
    await prepareHwgwController.prepare();
  } else {
    log.info("Skipping initial preparation");
  }

  log.info("Starting batched hacking");
  while (true) {
    const hwgwController = await HwgwController.new(ns, log, host);
    await hwgwController.positionTail();
    await hwgwController.run();
  }
}

export function autocomplete(data: AutocompleteData, args: string[]): string[] {
  if (args.length === 1) {
    return data.servers.filter((server) => server.startsWith(args[0]));
  }
  return [];
}
