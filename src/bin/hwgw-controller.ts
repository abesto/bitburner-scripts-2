import { AutocompleteData, NS } from '@ns';

import { autonuke } from '/autonuke';
import { db } from '/database';
import { Fmt } from '/fmt';
import { Log } from '/log';
import { PortRegistryClient } from '/services/PortRegistry/client';
import { SchedulerClient, withSchedulerClient } from '/services/Scheduler/client';
import { jobThreads } from '/services/Scheduler/types';

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([]);
  const posArgs = args._ as string[];
  const host = posArgs[0];

  const log = new Log(ns, "hwgw-controller");

  if (!host) {
    log.terror("Usage: run hwgw-controller.js <host>", { args });
    return;
  }

  const fmt = new Fmt(ns);
  const spacing = async () => (await db(ns)).config.hwgw.spacing;

  autonuke(ns, host);

  const portRegistryClient = new PortRegistryClient(ns);
  const schedulerResponsePort = await portRegistryClient.reservePort();
  const schedulerClient = new SchedulerClient(ns, log, schedulerResponsePort);

  // eslint-disable-next-line no-constant-condition
  log.info("Initial preparation: weaken, grow, weaken");
  while (shouldWeaken() || (await shouldGrow())) {
    const { jobId, threads } = await schedulerClient.start(
      {
        script: "/bin/hwgw-batch.js",
        args: [host, "--initial"],
        threads: 1,
        hostAffinity: { _type: "mustRunOn", host: "home" },
      },
      true
    );
    if (threads === 0) {
      log.info("Failed to start initial batch, sleeping then trying again");
      await ns.sleep(1000);
    }
    log.info("Batch started", { jobId });
    await schedulerClient.waitForJobFinished(jobId);
  }

  log.info("Starting batched hacking");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { jobId, threads } = await schedulerClient.start(
      {
        script: "/bin/hwgw-batch.js",
        args: [host],
        threads: 1,
        hostAffinity: { _type: "mustRunOn", host: "home" },
      },
      false,
      null
    );
    if (threads > 0) {
      log.info("Batch started", { jobId });
    } else {
      log.error("Failed to start batch", { jobId });
    }
    await report();
    await ns.sleep((await spacing()) * 5);
  }

  async function report() {
    const { jobs } = await withSchedulerClient(
      ns,
      log,
      async (schedulerClient) => await schedulerClient.status()
    );
    const countByKind = { batch: 0, hack: 0, weaken: 0, grow: 0 };
    for (const job of jobs) {
      if (
        job.spec.script.endsWith("/bin/hwgw-batch.js") &&
        job.spec.args[0] === host
      ) {
        countByKind.batch += jobThreads(job);
      } else if (
        job.spec.script.endsWith("/bin/payloads/hack.js") &&
        job.spec.args[0] === host
      ) {
        countByKind.hack += jobThreads(job);
      } else if (
        job.spec.script.endsWith("/bin/payloads/weaken.js") &&
        job.spec.args[0] === host
      ) {
        countByKind.weaken += jobThreads(job);
      } else if (
        job.spec.script.endsWith("/bin/payloads/grow.js") &&
        job.spec.args[0] === host
      ) {
        countByKind.grow += jobThreads(job);
      }
    }

    log.info("Threads", countByKind);
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
    const threshold = (await db(ns)).config.hwgw.moneyThreshold * moneyCapacity;

    if (moneyAvailable < threshold) {
      log.info("Money needs growing", {
        moneyAvailable: fmt.money(moneyAvailable),
        threshold: fmt.money(threshold),
      });
      return true;
    }
    return false;
  }
}

export function autocomplete(data: AutocompleteData, args: string[]): string[] {
  if (args.length === 1) {
    return data.servers.filter((server) => server.startsWith(args[0]));
  }
  return [];
}
