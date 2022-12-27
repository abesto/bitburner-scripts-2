import { NS } from '@ns';

import { Fmt } from '/fmt';
import { Log } from '/log';
import { db } from '/services/Database/client';
import { HwgwBatchVizClient } from '/services/HwgwBatchViz/client';
import { JobKind } from '/services/HWGwBatchViz/types';
import { PortRegistryClient } from '/services/PortRegistry/client';
import { NoResponseSchedulerClient, SchedulerClient } from '/services/Scheduler/client';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "hwgw-batch");

  const args = ns.flags([
    ["job", ""],
    ["task", -1],
    ["initial", false],
    ["dry-run", false],
  ]);
  const host = (args._ as string[])[0];

  const jobId = args["job"] as string;
  const taskId = args["task"] as number;
  const initial = args["initial"] as boolean;

  if (!host || !jobId || taskId < 0) {
    log.terror(
      "Usage: run hwgw-batch.js <host> --job <jobId> --task <taskId> [--initial] [--dry-run]",
      { args }
    );
    return;
  }

  const portRegistryClient = new PortRegistryClient(ns, log);
  const vizClient = new HwgwBatchVizClient(ns, log);

  if (initial) {
    ns.tail();
    await ns.sleep(0);
    ns.resizeTail(1000, 400);
    ns.moveTail(1400, 0);
  }

  async function finished() {
    const schedulerClient = new NoResponseSchedulerClient(ns, log);
    await schedulerClient.taskFinished(jobId, taskId);
    if (initial) {
      ns.closeTail();
    }
  }

  const fmt = new Fmt(ns);
  const memdb = await db(ns, log);
  const spacing = memdb.config.hwgw.spacing;

  const moneyMax = ns.getServerMaxMoney(host);
  const moneyStolenPerThread = ns.hackAnalyze(host) * moneyMax;
  if (moneyStolenPerThread === 0) {
    log.terror("moneyStolePerThread=0", {
      host,
      moneyMax,
      currentMoney: fmt.money(ns.getServerMoneyAvailable(host)),
      securityLevel: ns.getServerSecurityLevel(host),
    });
    await finished();
    return;
  }
  const moneyThreshold = moneyMax * memdb.config.hwgw.moneyThreshold;
  const moneySteal = moneyMax - moneyThreshold;

  const wantHackThreads = Math.floor(moneySteal / moneyStolenPerThread);
  const moneyAfterHack = moneyMax - moneyStolenPerThread * wantHackThreads;
  const hackSecurityGrowth = ns.hackAnalyzeSecurity(wantHackThreads);

  const overWeaken = Math.max(
    1,
    ns.getServerSecurityLevel(host) /
      (ns.getServerMinSecurityLevel(host) + hackSecurityGrowth)
  );

  const wantHackWeakenThreads = Math.ceil(
    (overWeaken *
      (initial ? ns.getServerSecurityLevel(host) : hackSecurityGrowth)) /
      0.05
  );

  const overGrow = Math.max(
    1.2,
    ns.getServerMaxMoney(host) / ns.getServerMoneyAvailable(host)
  );
  const growMultiplier = initial
    ? moneyMax / ns.getServerMoneyAvailable(host)
    : (1 + moneySteal / moneyAfterHack) * overGrow;
  const wantGrowThreads = Math.ceil(ns.growthAnalyze(host, growMultiplier));
  const growSecurityGrowth = ns.growthAnalyzeSecurity(wantGrowThreads);
  const wantGrowWeakenThreads = Math.ceil(
    (overWeaken * growSecurityGrowth) / 0.05
  );

  const weakenLength = ns.getWeakenTime(host);
  const growLength = ns.getGrowTime(host);
  const hackLength = ns.getHackTime(host);

  if (isNaN(moneyAfterHack)) {
    log.terror("wtf", {
      jobId,
      taskId,
      host,
      moneyMax,
      moneyStolenPerThread,
      moneyThreshold,
      moneySteal,
      wantHackThreads,
      moneyAfterHack,
      hackSecurityGrowth,
      wantHackWeakenThreads,
      growMultiplier,
      wantGrowThreads,
      growSecurityGrowth,
      wantGrowWeakenThreads,
    });
    await finished();
    return;
  }

  log.info("startup", {
    jobId,
    taskId,
    host,
    overWeaken,
    overGrow,
    moneyMax: fmt.money(moneyMax),
    moneyThreshold: fmt.money(moneyThreshold),
    moneySteal: fmt.money(moneySteal),
    wantHackThreads,
    moneyAfterHack: fmt.money(moneyAfterHack),
    hackSecurityGrowth,
    wantHackWeakenThreads,
    growMultiplier: fmt.percent(growMultiplier),
    wantGrowThreads,
    growSecurityGrowth,
    wantGrowWeakenThreads,
  });

  const growWeakenEnd = initial
    ? Date.now() + weakenLength + spacing * 5
    : parseFloat((args._ as string[])[1]);
  const growWeakenStart = growWeakenEnd - weakenLength;

  const growEnd = growWeakenEnd - spacing;
  const growStart = growEnd - growLength;

  const hackWeakenEnd = growEnd - spacing;
  const hackWeakenStart = hackWeakenEnd - weakenLength;

  const hackEnd = hackWeakenEnd - spacing;
  const hackStart = hackEnd - hackLength;

  const now = Date.now();
  if (
    growWeakenStart < now ||
    growStart < now ||
    hackWeakenStart < now ||
    hackStart < now
  ) {
    log.error("not enough time", {
      growWeakenStart: fmt.time(growWeakenStart - now),
      growStart: fmt.time(growStart - now),
      hackWeakenStart: fmt.time(hackWeakenStart - now),
      hackStart: fmt.time(hackStart - now),
    });
    await finished();
    return;
  }

  if (!initial) {
    await vizClient.plan({
      jobId,
      kind: "hack",
      plannedStart: hackStart,
      plannedEnd: hackEnd,
    });
  }
  await vizClient.plan({
    jobId,
    kind: "hack-weaken",
    plannedStart: hackWeakenStart,
    plannedEnd: hackWeakenEnd,
  });
  await vizClient.plan({
    jobId,
    kind: "grow",
    plannedStart: growStart,
    plannedEnd: growEnd,
  });
  await vizClient.plan({
    jobId,
    kind: "grow-weaken",
    plannedStart: growWeakenStart,
    plannedEnd: growWeakenEnd,
  });

  const sleepToHackWeaken = hackWeakenStart - Date.now();
  if (sleepToHackWeaken > 0) {
    log.info("Sleeping until hack-weaken start", {
      length: fmt.time(sleepToHackWeaken),
    });
  }
  await ns.sleep(sleepToHackWeaken);
  const { jobId: hackWeakenJobId, client: hackWeakenClient } = await schedule(
    "weaken",
    host,
    wantHackWeakenThreads,
    weakenLength
  );
  await vizClient.start({
    jobId,
    kind: "hack-weaken",
  });

  log.info("Sleeping until grow-weaken start", {
    length: fmt.time(growWeakenStart - Date.now()),
  });
  await ns.sleep(growWeakenStart - Date.now());
  const {
    jobId: growWeakenJobId,
    threads: scheduledGrowWeakenThreads,
    client: growWeakenClient,
  } = await schedule("weaken", host, wantGrowWeakenThreads, weakenLength);
  if (scheduledGrowWeakenThreads !== wantGrowWeakenThreads) {
    log.terror(
      "Scheduled grow-weaken threads does not match requested grow-weaken threads",
      { host, scheduledGrowWeakenThreads, wantGrowWeakenThreads }
    );
    await finished();
    return;
  }
  await vizClient.start({
    jobId,
    kind: "grow-weaken",
  });

  log.info("Sleeping until grow start", {
    length: fmt.time(growStart - Date.now()),
  });
  await ns.sleep(growStart - Date.now());
  const {
    jobId: growJobId,
    threads: scheduledGrowThreads,
    client: growClient,
  } = await schedule("grow", host, wantGrowThreads, growLength);
  if (
    scheduledGrowThreads !== wantGrowThreads &&
    ((initial && scheduledGrowThreads === 0) || !initial)
  ) {
    log.terror("Scheduled grow threads does not match requested grow threads", {
      host,
      scheduledGrowThreads,
      wantGrowThreads,
    });
    // TODO kill growWeaken batch
    await finished();
    return;
  }
  await vizClient.start({
    jobId,
    kind: "grow",
  });

  let hackJobId, hackClient;
  if (initial) {
    log.info("Skipping hack", { reason: "--initial" });
  } else {
    log.info("Sleeping until hack start", {
      length: fmt.time(hackStart - Date.now()),
    });
    await ns.sleep(hackStart - Date.now());
    const {
      jobId: _hackJobId,
      threads: scheduledHackThreads,
      client: _hackClient,
    } = await schedule("hack", host, wantHackThreads, hackLength);
    hackJobId = _hackJobId;
    hackClient = _hackClient;
    if (scheduledHackThreads !== wantHackThreads) {
      log.terror(
        "Scheduled hack threads does not match requested hack threads",
        { host, scheduledHackThreads, wantHackThreads }
      );
      // TODO kill all batches
    }
    await vizClient.start({
      jobId,
      kind: "hack",
    });
  }

  const fullTimeout = growWeakenEnd - Date.now() + spacing * 5;
  log.info("Waiting for everything to finish up", {
    ETA: fmt.time(fullTimeout),
  });
  if (hackJobId !== undefined && hackClient !== undefined) {
    await logDone(hackJobId, "hack", hackClient);
  }
  await logDone(hackWeakenJobId, "hack-weaken", hackWeakenClient);
  await logDone(growJobId, "grow", growClient);
  await logDone(growWeakenJobId, "grow-weaken", growWeakenClient);

  log.debug("All done, reporting");
  await finished();
  log.info("All done");

  async function logDone(
    childJobId: string,
    kind: JobKind,
    schedulerClient: SchedulerClient
  ): Promise<void> {
    try {
      await schedulerClient.waitForJobFinished(childJobId);
    } catch (e) {
      log.error("Error waiting for job to finish", {
        kind,
        jobId: childJobId,
        e,
      });
    }
    await vizClient.finished({ jobId, kind });
    await schedulerClient.release();
    log.info("Job finished", { kind, jobId: childJobId });
  }

  async function schedule(
    kind: string,
    host: string,
    wantThreads: number,
    eta: number
  ): Promise<{ jobId: string; threads: number; client: SchedulerClient }> {
    log.info("Starting job", { kind, wantThreads, eta: fmt.time(eta) });
    const responsePort = await portRegistryClient.reservePort();
    const schedulerClient = new SchedulerClient(ns, log, responsePort);
    const { jobId, threads } = await schedulerClient.start({
      script: `/bin/payloads/${kind}.js`,
      threads: wantThreads,
      args: [host],
    });
    log.info("Started job", { kind, jobId, threads, wantThreads });
    return { jobId, threads, client: schedulerClient };
  }
}
