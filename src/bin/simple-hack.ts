import { NS } from '@ns';

//import { autonuke } from "/autonuke";
import { db } from '/database';
import { Fmt } from '/fmt';

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([["threads", 0]]);
  const posArgs = args._ as string[];
  const host = posArgs[0];
  if (!host) {
    ns.tprint("ERROR No host specified");
    return;
  }
  const maxThreads = args.threads as number;
  if (!maxThreads) {
    ns.tprint("ERROR No threads specified");
    return;
  }
  if (!Number.isInteger(maxThreads)) {
    ns.tprint("ERROR Threads must be an integer");
    return;
  }

  ns.disableLog("ALL");
  const fmt = new Fmt(ns);

  //autonuke(ns, host);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await shouldWeaken()) {
      const threads = weakenThreads();
      ns.print(
        `Weakening ${host} with ${threads} threads ETA ${fmt.time(
          ns.getWeakenTime(host)
        )}`
      );
      await ns.weaken(host, { threads });
    } else if (await shouldGrow()) {
      const threads = growThreads();
      ns.print(
        `Growing ${host} with ${threads} threads ETA ${fmt.time(
          ns.getGrowTime(host)
        )}`
      );
      await ns.grow(host, { threads: growThreads() });
    } else {
      const threads = hackThreads();
      ns.print(
        `Hacking ${host} with ${threads} threads ETA ${fmt.time(
          ns.getHackTime(host)
        )}`
      );
      const stolen = await ns.hack(host, { threads: hackThreads() });
      ns.print(`Stole ${fmt.money(stolen)} from ${host}`);
    }
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

  function weakenThreads(): number {
    return maxThreads;
    /*
    const minSecurity = ns.getServerMinSecurityLevel(host);
    const currentSecurity = ns.getServerSecurityLevel(host);
    const threshold = (await db(ns)).config.simpleHack.securityThreshold + minSecurity;

    if (currentSecurity <= threshold) {
      return 0;
    }

    const WEAKEN_AMOUNT = 0.05; // Docs say so

    // TODO account for cores
    return Math.ceil((currentSecurity - threshold) / WEAKEN_AMOUNT);
    */
  }

  function growThreads(): number {
    return maxThreads;
    /*
    const moneyAvailable = ns.getServerMoneyAvailable(host);
    const moneyCapacity = ns.getServerMaxMoney(host);
    const target = (await db(ns)).config.simpleHack.moneyThreshold * moneyCapacity;
    const multiplier = target / moneyAvailable;

    if (multiplier <= 1) {
      return 0;
    }

    // TODO account for cores
    return Math.ceil(ns.growthAnalyze(host, multiplier));
    */
  }

  function hackThreads(): number {
    return maxThreads;
    /*
    const moneyAvailable = ns.getServerMoneyAvailable(host);
    const moneyCapacity = ns.getServerMaxMoney(host);
    const target = (await db(ns)).config.simpleHack.moneyThreshold * moneyCapacity;
    const amount = moneyAvailable - target;

    if (amount <= 0) {
      return 0;
    }

    // TODO account for cores
    return Math.ceil(ns.hackAnalyzeThreads(host, amount));
    */
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
