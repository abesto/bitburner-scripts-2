import { NS } from '@ns';

import { db } from '/database';
import { Fmt } from '/fmt';
import { Log } from '/log';
import { PortRegistryClient } from '/services/PortRegistry/client';
import { NoResponseSchedulerClient, SchedulerClient } from '/services/Scheduler/client';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "hwgw-batch");

  const args = ns.flags([
    ["job", ""],
    ["task", -1],
    ["initial", false],
  ]);
  const host = (args._ as string[])[0];
  const jobId = args["job"] as string;
  const taskId = args["task"] as number;
  const initial = args["initial"] as boolean;

  if (!host || !jobId || taskId < 0) {
    log.terror(
      "Usage: run hwgw-batch.js <host> --job <jobId> --task <taskId> [--initial]",
      { args }
    );
    return;
  }

  const portRegistryClient = new PortRegistryClient(ns);

  async function finished() {
    const schedulerClient = new NoResponseSchedulerClient(ns, log);
    await schedulerClient.taskFinished(jobId, taskId);
    if (initial) {
      ns.closeTail();
    }
  }

  try {
    await db(ns);
  } catch (e) {
    log.terror("Failed to get DB", { e });
    await finished();
    return;
  }

  const spacing = (await db(ns)).config.hwgw.spacing;

  const moneyMax = ns.getServerMaxMoney(host);
  const moneyStolenPerThread = ns.hackAnalyze(host) * moneyMax;
  const moneyThreshold = moneyMax * (await db(ns)).config.hwgw.moneyThreshold;
  const moneySteal = moneyMax - moneyThreshold;

  const wantHackThreads = Math.floor(moneySteal / moneyStolenPerThread);
  const moneyAfterHack = moneyMax - moneyStolenPerThread * wantHackThreads;
  const hackSecurityGrowth = ns.hackAnalyzeSecurity(wantHackThreads);
  const hackWeakenThreads = Math.ceil(
    (initial ? ns.getServerSecurityLevel(host) : hackSecurityGrowth) / 0.05
  );

  const growMultiplier = initial
    ? moneyMax / ns.getServerMoneyAvailable(host)
    : 1 + moneySteal / moneyAfterHack;
  const wantGrowThreads = Math.ceil(ns.growthAnalyze(host, growMultiplier));
  const growSecurityGrowth = ns.growthAnalyzeSecurity(wantGrowThreads);
  const wantGrowWeakenThreads = Math.ceil(growSecurityGrowth / 0.05);

  const weakenLength = ns.getWeakenTime(host);
  const growLength = ns.getGrowTime(host);
  const hackLength = ns.getHackTime(host);

  const fmt = new Fmt(ns);
  log.info("startup", {
    jobId,
    taskId,
    host,
    moneyMax: fmt.money(moneyMax),
    moneyThreshold: fmt.money(moneyThreshold),
    moneySteal: fmt.money(moneySteal),
    wantHackThreads,
    moneyAfterHack: fmt.money(moneyAfterHack),
    hackSecurityGrowth,
    hackWeakenThreads,
    growMultiplier: fmt.percent(growMultiplier),
    wantGrowThreads,
    growSecurityGrowth,
    wantGrowWeakenThreads,
  });

  const { jobId: hackWeakenJobId, client: hackWeakenClient } = await schedule(
    "weaken",
    host,
    hackWeakenThreads,
    weakenLength
  );

  const hackWeakenStart = Date.now();
  const hackWeakenEnd = hackWeakenStart + weakenLength;
  const hackEnd = hackWeakenEnd - spacing;
  const hackStart = hackEnd - hackLength;
  const growEnd = hackWeakenEnd + spacing;
  const growStart = growEnd - growLength;
  const growWeakenEnd = growEnd + spacing;
  const growWeakenStart = growWeakenEnd - weakenLength;

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
      { scheduledGrowWeakenThreads, wantGrowWeakenThreads }
    );
    await finished();
    return;
  }

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
      scheduledGrowThreads,
      wantGrowThreads,
    });
    // TODO kill growWeaken batch
    await finished();
    return;
  }

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
        { scheduledHackThreads, wantHackThreads }
      );
      // TODO kill all batches
    }
  }

  const fullTimeout = growWeakenEnd - Date.now() + spacing * 5;
  log.info("Waiting for everything to finish up", {
    ETA: fmt.time(fullTimeout),
  });
  if (!initial && hackJobId !== undefined && hackClient !== undefined) {
    await logDone(hackJobId, "hack", hackClient);
  }
  if (!initial && hackWeakenJobId !== undefined) {
    await logDone(hackWeakenJobId, "hack-weaken", hackWeakenClient);
  }
  await logDone(growJobId, "grow", growClient);
  await logDone(growWeakenJobId, "grow-weaken", growWeakenClient);

  log.debug("All done, reporting");
  await finished();
  log.info("All done");

  async function logDone(
    jobId: string,
    kind: string,
    schedulerClient: SchedulerClient
  ): Promise<void> {
    try {
      await schedulerClient.waitForJobFinished(jobId);
    } catch (e) {
      log.error("Error waiting for job to finish", { kind, jobId, e });
    }
    await portRegistryClient.releasePort(schedulerClient.responsePortNumber);
    log.info("Job finished", { kind, jobId });
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
