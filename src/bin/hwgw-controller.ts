/* eslint-disable no-constant-condition */
import { AutocompleteData, NS } from "@ns";

import { autonuke } from "/autonuke";
import { Fmt } from "/fmt";
import { Formulas, stalefish } from "/Formulas";
import HwgwEstimator from "/HwgwEstimator";
import { Log } from "/log";
import { db } from "/services/Database/client";
import { PortRegistryClient } from "/services/PortRegistry/client";
import { SchedulerClient } from "/services/Scheduler/client";
import { HostAffinity, JobId } from "/services/Scheduler/types";

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
  const job = args.job as string;
  const task = args.task as number;

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

  if (!job || task < 0) {
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

  // Start monitor
  await schedulerClient.start(
    {
      script: "/bin/hwgw-monitor.js",
      args: [host],
      threads: 1,
    },
    {
      finishNotificationPort: null,
    }
  );

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
  ns.resizeTail(930, 345);
  ns.moveTail(1413, 0);

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
    await consumeFinishedJobs();
    if (ns.getPlayer().skills.hacking > validUpTo.skills.hacking) {
      await handleHackSkillGoingOutOfRange();
    }
    const maxDepth = await calculateMaxDepth();
    const hack_time = formulas.getHackTime(host);
    const weak_time = formulas.getWeakenTime(host);
    const grow_time = formulas.getGrowTime(host);

    recalculateStalefish(weak_time, grow_time, hack_time, maxDepth);
    if (stalefishResult === undefined) {
      log.terror("Stalefish failed", { host, t0 });
      return;
    }
    const { period, depth } = stalefishResult;

    const periodStart = period * Math.floor(Date.now() / period);
    if (periodStart <= lastPeriodStart) {
      const nextPeriodStart = periodStart + period;
      await ns.sleep(Date.now() - nextPeriodStart);
      continue;
    }
    lastPeriodStart = periodStart;
    await scheduleBatch(
      depth,
      period,
      hack_time,
      weak_time,
      grow_time,
      periodStart
    );
  }

  async function scheduleBatch(
    depth: never,
    period: never,
    hack_time: number,
    weak_time: number,
    grow_time: number,
    periodStart: number
  ) {
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

  function recalculateStalefish(
    weak_time: number,
    grow_time: number,
    hack_time: number,
    maxDepth: number
  ) {
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
      log.info("Stalefish result", { host, stalefishResult });
    }
  }

  async function calculateMaxDepth() {
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
    return maxDepth;
  }

  async function handleHackSkillGoingOutOfRange() {
    log.warn(
      "Hacking skill increased, waiting for jobs to finish and recalculating"
    );
    await waitForAllJobsToFinish();
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

  async function waitForAllJobsToFinish() {
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
  }

  async function consumeFinishedJobs() {
    while (true) {
      const response = await jobFinished.pollNextJobFinished();
      if (response !== null) {
        jobs.splice(jobs.indexOf(response.jobId), 1);
      } else {
        break;
      }
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
