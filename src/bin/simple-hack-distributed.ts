import { AutocompleteData, NS } from '@ns';

import { autonuke } from '/autonuke';
import { Fmt } from '/fmt';
import { Log } from '/log';
import { db } from '/services/Database/client';
import { PortRegistryClient } from '/services/PortRegistry/client';
import { SchedulerClient } from '/services/Scheduler/client';

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([]);
  const posArgs = args._ as string[];
  const host = posArgs[0];

  const log = new Log(ns, "simple-hack-distributed");
  const portRegistry = new PortRegistryClient(ns, log);
  const schedulerResponsePort = await portRegistry.reservePort();
  const scheduler = new SchedulerClient(ns, log, schedulerResponsePort);

  if (!host) {
    log.terror("No host specified");
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
        await calcMaxThreads("/bin/payloads/weaken.js"),
        ns.getWeakenTime(host)
      );
    } else if (await shouldGrow()) {
      await schedule(
        "grow",
        host,
        await calcMaxThreads("/bin/payloads/grow.js"),
        ns.getGrowTime(host)
      );
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
    const { jobId, threads } = await scheduler.start({
      script: `/bin/payloads/${kind}.js`,
      args: [host],
      threads: wantThreads,
    });
    log.info("Batch started", {
      kind,
      host,
      threads,
      jobId,
      eta: fmt.time(eta),
    });
    await scheduler.waitForJobFinished(jobId);
    log.info("Batch finished", { kind, host, threads, jobId });
  }

  async function shouldWeaken(): Promise<boolean> {
    const minSecurity = ns.getServerMinSecurityLevel(host);
    const currentSecurity = ns.getServerSecurityLevel(host);
    const threshold =
      (await db(ns, log)).config.simpleHack.securityThreshold + minSecurity;

    if (currentSecurity > threshold) {
      log.info("Security needs weakening", {
        host,
        currentSecurity,
        threshold,
      });
      return true;
    }
    return false;
  }

  async function shouldGrow(): Promise<boolean> {
    const moneyAvailable = ns.getServerMoneyAvailable(host);
    const moneyCapacity = ns.getServerMaxMoney(host);
    const threshold =
      (await db(ns, log)).config.simpleHack.moneyThreshold * moneyCapacity;

    if (moneyAvailable < threshold) {
      log.info("Money needs growing", {
        host,
        moneyAvailable: fmt.money(moneyAvailable),
        threshold: fmt.money(threshold),
      });
      return true;
    }
    return false;
  }

  async function hackThreads(): Promise<number> {
    const moneyAvailable = ns.getServerMoneyAvailable(host);
    const moneyCapacity = ns.getServerMaxMoney(host);
    const target =
      (await db(ns, log)).config.simpleHack.moneyThreshold * moneyCapacity;
    const amount = moneyAvailable - target;

    if (amount <= 0) {
      return 0;
    }

    // TODO account for cores
    return Math.ceil(ns.hackAnalyzeThreads(host, amount));
  }

  async function calcMaxThreads(script: string): Promise<number> {
    const { capacity } = await scheduler.capacity();
    const maxRam = capacity.reduce((acc, cap) => acc + cap.freeMem, 0);
    const ramUsed = ns.getServerUsedRam(host);
    const ramAvailable = maxRam - ramUsed;
    const scriptRam = ns.getScriptRam(script);
    const maxThreads = Math.floor(ramAvailable / scriptRam);
    return maxThreads;
  }
}

export function autocomplete(data: AutocompleteData, args: string[]): string[] {
  if (args.length === 1) {
    return data.servers.filter((server) => server.startsWith(args[0]));
  }
  return [];
}
