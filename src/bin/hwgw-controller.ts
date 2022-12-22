import { AutocompleteData, NS } from "@ns";

import { autonuke } from "/autonuke";
import { db } from "/database";
import { Fmt } from "/fmt";
import { SupervisorCtl } from "/supervisorctl";
import { SupervisorEvents } from "/supervisorEvent";

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([]);
  const posArgs = args._ as string[];
  const host = posArgs[0];

  const supervisorctl = new SupervisorCtl(ns);
  const supervisorEvents = new SupervisorEvents(ns);

  if (!host) {
    ns.tprint("ERROR No host specified");
    return;
  }

  ns.disableLog("ALL");
  const fmt = new Fmt(ns);
  const spacing = async () => (await db(ns)).config.hwgw.spacing;

  autonuke(ns, host);

  // eslint-disable-next-line no-constant-condition
  ns.print("Initial preparation: weaken, grow");
  while (shouldWeaken() || (await shouldGrow())) {
    const weakenLength = ns.getWeakenTime(host);
    const { batchId: weakenBatchId } = await schedule(
      "weaken",
      host,
      weakenThreads(),
      weakenLength
    );

    const weakenEta = Date.now() + weakenLength;

    const growLength = ns.getGrowTime(host);
    const growTargetEnd = weakenEta + (await spacing());
    const growStart = growTargetEnd - growLength;
    const growSleep = growStart - Date.now();
    ns.print(`Sleeping ${fmt.time(growSleep)} until grow`);
    await ns.sleep(growSleep);

    const { batchId: growBatchId } = await schedule(
      "grow",
      host,
      growThreads(),
      growLength
    );

    await Promise.all([
      supervisorEvents.waitForBatchDone(weakenBatchId),
      supervisorEvents.waitForBatchDone(growBatchId),
    ]);
  }

  ns.print("Initial preparation: weaken");
  while (shouldWeaken()) {
    const weakenLength = ns.getWeakenTime(host);
    const { batchId: weakenBatchId } = await schedule(
      "weaken",
      host,
      weakenThreads(),
      weakenLength
    );
    await supervisorEvents.waitForBatchDone(weakenBatchId);
  }

  ns.print("Starting batched hacking");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    ns.print("Starting batch");
    await supervisorctl.start("/dist/bin/hwgw-batch.js", [host], 1, true);
    await report();
    await ns.sleep((await spacing()) * 5);
  }

  async function report() {
    const memdb = await db(ns);
    const countByKind = { batch: 0, hack: 0, weaken: 0, grow: 0 };
    for (const batch of Object.values(memdb.supervisor.batches)) {
      if (
        batch.script.endsWith("/bin/hwgw-batch.js") &&
        batch.args[0] === host
      ) {
        countByKind.batch += batch.threads;
      } else if (
        batch.script.endsWith("/dist/bin/payloads/hack.js") &&
        batch.args[0] === host
      ) {
        countByKind.hack += batch.threads;
      } else if (
        batch.script.endsWith("/dist/bin/payloads/weaken.js") &&
        batch.args[0] === host
      ) {
        countByKind.weaken += batch.threads;
      } else if (
        batch.script.endsWith("/dist/bin/payloads/grow.js") &&
        batch.args[0] === host
      ) {
        countByKind.grow += batch.threads;
      }
    }

    ns.print(
      `Batches: ${countByKind.batch} Hacks: ${countByKind.hack} Weaken: ${countByKind.weaken} Grow: ${countByKind.grow}`
    );
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
    const { batchId, threads } = await supervisorEvents.waitForBatchStarted(
      requestId
    );
    ns.print(
      `Starting ${kind} against ${host} with ${threads}/${wantThreads} threads ETA ${fmt.time(
        eta
      )}`
    );
    return { batchId, threads };
  }

  function shouldWeaken(): boolean {
    const minSecurity = ns.getServerMinSecurityLevel(host);
    const currentSecurity = ns.getServerSecurityLevel(host);

    if (currentSecurity > minSecurity) {
      ns.print(
        `Security ${currentSecurity} > ${minSecurity} -> needs weakening ${host}`
      );
      return true;
    }
    return false;
  }

  async function shouldGrow(): Promise<boolean> {
    const moneyAvailable = ns.getServerMoneyAvailable(host);
    const moneyCapacity = ns.getServerMaxMoney(host);
    const threshold = (await db(ns)).config.hwgw.moneyThreshold * moneyCapacity;

    if (moneyAvailable < threshold) {
      ns.print(
        `Money ${fmt.money(moneyAvailable)} < ${fmt.money(
          threshold
        )} -> needs growing ${host}`
      );
      return true;
    }
    return false;
  }

  function weakenThreads(): number {
    const minSecurity = ns.getServerMinSecurityLevel(host);
    const currentSecurity = ns.getServerSecurityLevel(host);

    if (currentSecurity <= minSecurity) {
      return 0;
    }

    const WEAKEN_AMOUNT = 0.05; // Docs say so

    // TODO account for cores
    return Math.max(
      1,
      Math.ceil((currentSecurity - minSecurity) / WEAKEN_AMOUNT)
    );
  }

  function growThreads(): number {
    const moneyAvailable = ns.getServerMoneyAvailable(host);
    const moneyCapacity = ns.getServerMaxMoney(host);
    const multiplier = moneyCapacity / moneyAvailable;

    if (multiplier <= 1) {
      return 0;
    }

    // TODO account for cores
    return Math.max(1, Math.ceil(ns.growthAnalyze(host, multiplier)));
  }
}

export function autocomplete(data: AutocompleteData, args: string[]): string[] {
  if (args.length === 1) {
    return data.servers.filter((server) => server.startsWith(args[0]));
  }
  return [];
}
