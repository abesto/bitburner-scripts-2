import { NS } from "@ns";
import { db } from "/database";
import { Fmt } from "/fmt";
import { silentTimeout, timeout } from "/promise";
import { SupervisorCtl, thisProcessFinished } from "/supervisorctl";
import { SupervisorEvents } from "/supervisorEvent";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const args = ns.flags([["batch", ""]]);
  const host = (args._ as string[])[0];
  const batchId = args["batch"] as string;
  if (!host || !batchId) {
    throw new Error(
      `Usage: run hwgw-batch.js <host> --batch <batch-id>\nGot args: ${JSON.stringify(
        args
      )}`
    );
  }

  const supervisorEvents = new SupervisorEvents(ns);
  // Self-ACK, the controller doesn't care
  // TODO make this timeout configurable
  await silentTimeout(
    supervisorEvents.waitForBatchStartedByBatchId(batchId),
    200
  );

  try {
    await db(ns);
  } catch (e) {
    ns.tprint(`ERROR: failed to get DB ${e}`);
    thisProcessFinished(ns);
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
  const hackWeakenThreads = Math.ceil(hackSecurityGrowth / 0.05);

  const growMultiplier = 1 + moneySteal / moneyAfterHack;
  const growThreads = Math.ceil(ns.growthAnalyze(host, growMultiplier));
  const growSecurityGrowth = ns.growthAnalyzeSecurity(growThreads);
  const growWeakenThreads = Math.ceil(growSecurityGrowth / 0.05);

  const weakenLength = ns.getWeakenTime(host);
  const growLength = ns.getGrowTime(host);
  const hackLength = ns.getHackTime(host);

  const fmt = new Fmt(ns);
  ns.print(
    fmt.keyValue(
      ["batchId", batchId],
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

  const supervisorctl = new SupervisorCtl(ns);

  const { batchId: hackWeakenBatchId } = await schedule(
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
  const { batchId: growWeakenBatchId, threads: scheduledGrowWeakenThreads } =
    await schedule("weaken", host, growWeakenThreads, weakenLength);
  if (scheduledGrowWeakenThreads !== growWeakenThreads) {
    ns.tprint(
      `ERROR Scheduled ${scheduledGrowWeakenThreads} grow-weaken threads, wanted ${growWeakenThreads}`
    );
    thisProcessFinished(ns);
    return;
  }

  ns.print(`Sleeping for ${fmt.time(growStart - Date.now())} until grow start`);
  await ns.sleep(growStart - Date.now());
  const { batchId: growBatchId, threads: growThreadsScheduled } =
    await schedule("grow", host, growThreads, growLength);
  if (growThreadsScheduled !== growThreads) {
    ns.tprint(
      `ERROR Scheduled ${growThreadsScheduled} grow-hack threads, wanted ${growThreads}`
    );
    thisProcessFinished(ns);
    // TODO kill growWeaken batch
    return;
  }

  ns.print(`Sleeping for ${fmt.time(hackStart - Date.now())} until hack start`);
  await ns.sleep(hackStart - Date.now());
  const { batchId: hackBatchId, threads: hackThreadsScheduled } =
    await schedule("hack", host, hackThreads, hackLength);
  if (hackThreadsScheduled !== hackThreads) {
    ns.print(
      `ERROR Scheduled ${hackThreadsScheduled} hack threads, wanted ${hackThreads}`
    );
    // TODO kill all batches
  }

  const fullTimeout = growWeakenEnd - Date.now() + spacing * 5;
  ns.print(
    `Waiting for everything to finish up, at most ${fmt.time(fullTimeout)}`
  );
  await silentTimeout(
    Promise.all([
      logDone(hackWeakenBatchId, "hack-weaken"),
      logDone(growWeakenBatchId, "grow-weaken"),
      logDone(growBatchId, "grow"),
      logDone(hackBatchId, "hack"),
    ]),
    fullTimeout
  );

  ns.print("All done, reporting");
  thisProcessFinished(ns);
  // Self-ACK, controller doesn't care
  // TODO make this timeout configurable
  ns.print("Self-ACK");
  await silentTimeout(supervisorEvents.waitForBatchDone(batchId), 200);
  ns.print("All done");

  async function logDone(batchId: string, kind: string): Promise<void> {
    await supervisorEvents.waitForBatchDone(batchId);
    ns.print(`Done ${kind} ${batchId}`);
  }

  async function schedule(
    kind: string,
    host: string,
    wantThreads: number,
    eta: number
  ): Promise<{ batchId: string; threads: number }> {
    const requestId = await supervisorctl.start(
      `/dist/bin/payloads/${kind}.js`,
      [host],
      wantThreads
    );
    ns.print(
      `Starting ${kind} against ${host} with ${wantThreads} threads ETA ${fmt.time(
        eta
      )} batchId ${batchId}`
    );
    try {
      const { batchId, threads } = (await timeout(
        supervisorEvents.waitForBatchStarted(requestId),
        2000
      )) as { batchId: string; threads: number };
      ns.print(
        `Started ${kind} batchId ${batchId} threads ${threads}/${wantThreads}`
      );
      return { batchId, threads };
    } catch (e) {
      ns.tprint(
        `ERROR scheduling ${wantThreads} ${kind} against ${host} on ${ns.getHostname()} (probably timeout)`
      );
      return { batchId: "", threads: 0 };
    }
  }
}
