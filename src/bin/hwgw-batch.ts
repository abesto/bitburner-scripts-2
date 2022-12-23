import { NS } from "@ns";
import { db } from "/database";
import { Fmt } from "/fmt";
import { silentTimeout } from "/promise";
import { PortRegistryClient } from "/services/PortRegistry/client";
import {
  NoResponseSchedulerClient,
  SchedulerClient,
} from "/services/Scheduler/client";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
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
    throw new Error(
      `Usage: run hwgw-batch.js <host> --job <jobId> --task <taskId> [--initial]\nGot args: ${JSON.stringify(
        args
      )}`
    );
  }

  const portRegistryClient = new PortRegistryClient(ns);

  async function finished() {
    const schedulerClient = new NoResponseSchedulerClient(ns);
    await schedulerClient.taskFinished(jobId, taskId);
    if (initial) {
      ns.closeTail();
    }
  }

  try {
    await db(ns);
  } catch (e) {
    ns.tprint(`ERROR: failed to get DB ${e}`);
    await finished();
    return;
  }

  const spacing = (await db(ns)).config.hwgw.spacing;

  const moneyMax = ns.getServerMaxMoney(host);
  const moneyStolenPerThread = ns.hackAnalyze(host) * moneyMax;
  const moneyThreshold = moneyMax * (await db(ns)).config.hwgw.moneyThreshold;
  const moneySteal = moneyMax - moneyThreshold;

  const hackThreads = Math.floor(moneySteal / moneyStolenPerThread);
  const moneyAfterHack = moneyMax - moneyStolenPerThread * hackThreads;
  const hackSecurityGrowth = ns.hackAnalyzeSecurity(hackThreads);
  const hackWeakenThreads = Math.ceil(
    (initial ? ns.getServerSecurityLevel(host) : hackSecurityGrowth) / 0.05
  );

  const growMultiplier = initial
    ? moneyMax / ns.getServerMoneyAvailable(host)
    : 1 + moneySteal / moneyAfterHack;
  const growThreads = Math.ceil(ns.growthAnalyze(host, growMultiplier));
  const growSecurityGrowth = ns.growthAnalyzeSecurity(growThreads);
  const growWeakenThreads = Math.ceil(growSecurityGrowth / 0.05);

  const weakenLength = ns.getWeakenTime(host);
  const growLength = ns.getGrowTime(host);
  const hackLength = ns.getHackTime(host);

  const fmt = new Fmt(ns);
  ns.print(
    fmt.keyValue(
      ["jobId", jobId],
      ["taskId", taskId.toString()],
      ["host", host],
      ["moneyMax", fmt.money(moneyMax)],
      ["moneyThreshold", fmt.money(moneyThreshold)],
      ["moneySteal", fmt.money(moneySteal)],
      ["hackThreads", hackThreads.toString()],
      ["moneyAfterHack", fmt.money(moneyAfterHack)],
      ["hackSecurityGrowth", hackSecurityGrowth.toString()],
      ["hackWeakenThreads", hackWeakenThreads.toString()],
      ["growMultiplier", fmt.percent(growMultiplier)],
      ["growThreads", growThreads.toString()],
      ["growSecurityGrowth", growSecurityGrowth.toString()],
      ["growWeakenThreads", growWeakenThreads.toString()]
    )
  );

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

  ns.print(
    `Sleeping for ${fmt.time(
      growWeakenStart - Date.now()
    )} until grow-weaken start`
  );
  await ns.sleep(growWeakenStart - Date.now());
  const {
    jobId: growWeakenJobId,
    threads: scheduledGrowWeakenThreads,
    client: growWeakenClient,
  } = await schedule("weaken", host, growWeakenThreads, weakenLength);
  if (scheduledGrowWeakenThreads !== growWeakenThreads) {
    ns.tprint(
      `ERROR Scheduled ${scheduledGrowWeakenThreads} grow-weaken threads, wanted ${growWeakenThreads}`
    );
    await finished();
    return;
  }

  ns.print(`Sleeping for ${fmt.time(growStart - Date.now())} until grow start`);
  await ns.sleep(growStart - Date.now());
  const {
    jobId: growJobId,
    threads: growThreadsScheduled,
    client: growClient,
  } = await schedule("grow", host, growThreads, growLength);
  if (
    growThreadsScheduled !== growThreads &&
    ((initial && growThreadsScheduled === 0) || !initial)
  ) {
    ns.tprint(
      `ERROR Scheduled ${growThreadsScheduled} grow threads, wanted ${growThreads}`
    );
    // TODO kill growWeaken batch
    await finished();
    return;
  }

  let hackJobId, hackClient;
  if (initial) {
    ns.print("Skipping hack");
  } else {
    ns.print(
      `Sleeping for ${fmt.time(hackStart - Date.now())} until hack start`
    );
    await ns.sleep(hackStart - Date.now());
    const {
      jobId: _hackJobId,
      threads: hackThreadsScheduled,
      client: _hackClient,
    } = await schedule("hack", host, hackThreads, hackLength);
    hackJobId = _hackJobId;
    hackClient = _hackClient;
    if (hackThreadsScheduled !== hackThreads) {
      ns.print(
        `ERROR Scheduled ${hackThreadsScheduled} hack threads, wanted ${hackThreads}`
      );
      // TODO kill all batches
    }
  }

  const fullTimeout = growWeakenEnd - Date.now() + spacing * 5;
  ns.print(`Waiting for everything to finish up, ETA ${fmt.time(fullTimeout)}`);
  if (!initial && hackJobId !== undefined && hackClient !== undefined) {
    await logDone(hackJobId, "hack", hackClient);
  }
  if (!initial && hackWeakenJobId !== undefined) {
    await logDone(hackWeakenJobId, "hack-weaken", hackWeakenClient);
  }
  await logDone(growJobId, "grow", growClient);
  await logDone(growWeakenJobId, "grow-weaken", growWeakenClient);

  ns.print("All done, reporting");
  await finished();
  ns.print("All done");

  async function logDone(
    jobId: string,
    kind: string,
    schedulerClient: SchedulerClient
  ): Promise<void> {
    try {
      await schedulerClient.waitForJobFinished(jobId);
    } catch (e) {
      ns.print(`ERROR waiting for ${kind} ${jobId} to finish: ${e}`);
    }
    await portRegistryClient.releasePort(schedulerClient.responsePortNumber);
    ns.print(`Done ${kind} ${jobId}`);
  }

  async function schedule(
    kind: string,
    host: string,
    wantThreads: number,
    eta: number
  ): Promise<{ jobId: string; threads: number; client: SchedulerClient }> {
    ns.print(
      `Starting ${kind} against ${host} with ${wantThreads} threads ETA ${fmt.time(
        eta
      )}`
    );
    const responsePort = await portRegistryClient.reservePort();
    const schedulerClient = new SchedulerClient(ns, responsePort);
    const { jobId, threads } = await schedulerClient.start({
      script: `/dist/bin/payloads/${kind}.js`,
      threads: wantThreads,
      args: [host],
    });
    ns.print(
      `Started ${kind} jobId ${jobId} threads ${threads}/${wantThreads}`
    );
    return { jobId, threads, client: schedulerClient };
  }
}
