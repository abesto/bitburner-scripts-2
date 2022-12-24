import { AutocompleteData, NS } from '@ns';

import { autonuke } from '/autonuke';
import { db } from '/database';
import { Fmt } from '/fmt';
import { SupervisorCtl } from '/supervisorctl';
import { SupervisorEvents } from '/supervisorEvent';

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

  autonuke(ns, host);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await shouldWeaken()) {
      await schedule(
        "weaken",
        host,
        await weakenThreads(),
        ns.getWeakenTime(host)
      );
    } else if (await shouldGrow()) {
      await schedule("grow", host, growThreads(), ns.getGrowTime(host));
    } else {
      await schedule("hack", host, await hackThreads(), ns.getHackTime(host));
    }
  }

  async function schedule(
    kind: string,
    host: string,
    wantThreads: number,
    eta: number
  ): Promise<void> {
    const requestId = await supervisorctl.start(
      `/bin/payloads/${kind}.js`,
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
    await supervisorEvents.waitForBatchDone(batchId);
    ns.print(`Finished ${kind} against ${host}`);
  }

  async function shouldWeaken(): Promise<boolean> {
    const minSecurity = ns.getServerMinSecurityLevel(host);
    const currentSecurity = ns.getServerSecurityLevel(host);
    const threshold =
      (await db(ns)).config.simpleHack.securityThreshold + minSecurity;

    if (currentSecurity > threshold) {
      ns.print(
        `Security ${currentSecurity} > ${threshold} -> needs weakening ${host}`
      );
      return true;
    }
    return false;
  }

  async function shouldGrow(): Promise<boolean> {
    const moneyAvailable = ns.getServerMoneyAvailable(host);
    const moneyCapacity = ns.getServerMaxMoney(host);
    const threshold =
      (await db(ns)).config.simpleHack.moneyThreshold * moneyCapacity;

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

  async function weakenThreads(): Promise<number> {
    const minSecurity = ns.getServerMinSecurityLevel(host);
    const currentSecurity = ns.getServerSecurityLevel(host);
    const threshold =
      (await db(ns)).config.simpleHack.securityThreshold + minSecurity;

    if (currentSecurity <= threshold) {
      return 0;
    }

    const WEAKEN_AMOUNT = 0.05; // Docs say so

    // TODO account for cores
    return Math.ceil((currentSecurity - threshold) / WEAKEN_AMOUNT);
  }

  function growThreads(): number {
    const moneyAvailable = ns.getServerMoneyAvailable(host);
    const moneyCapacity = ns.getServerMaxMoney(host);
    const multiplier = moneyCapacity / moneyAvailable;

    if (multiplier <= 1) {
      return 0;
    }

    // TODO account for cores
    return Math.ceil(ns.growthAnalyze(host, multiplier));
  }

  async function hackThreads(): Promise<number> {
    const moneyAvailable = ns.getServerMoneyAvailable(host);
    const moneyCapacity = ns.getServerMaxMoney(host);
    const target =
      (await db(ns)).config.simpleHack.moneyThreshold * moneyCapacity;
    const amount = moneyAvailable - target;

    if (amount <= 0) {
      return 0;
    }

    // TODO account for cores
    return Math.ceil(ns.hackAnalyzeThreads(host, amount));
  }

  /*
  function calcMaxThreads(): number {
    const maxRam = ns.getServerMaxRam(host);
    const ramUsed = ns.getServerUsedRam(host);
    const ramAvailable = maxRam - ramUsed;
    const scriptRam = ns.getScriptRam(ns.getScriptName());
    const maxThreads = Math.floor(ramAvailable / scriptRam);
    ns.print(
      `Free RAM: ${fmt.memory(ramAvailable)} / ${fmt.memory(
        maxRam
      )} scriptRam: ${fmt.memory(scriptRam)} -> max threads: ${maxThreads}`
    );
    return Math.floor(ramAvailable / scriptRam);
  }
  */
}

export function autocomplete(data: AutocompleteData, args: string[]): string[] {
  if (args.length === 1) {
    return data.servers.filter((server) => server.startsWith(args[0]));
  }
  return [];
}
