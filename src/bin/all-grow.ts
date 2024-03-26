import { AutocompleteData, NS } from "@ns";

import { Fmt } from "/fmt";
import { Log } from "/log";
import { PortRegistryClient } from "/services/PortRegistry/client";
import { SchedulerClient } from "/services/Scheduler/client";

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "all-grow");
  const fmt = new Fmt(ns);

  const growPayload = "bin/payloads/grow.js";
  const weakenPayload = "bin/payloads/weaken.js";
  const host = ns.args[0] as string;
  const scriptmem = ns.getScriptRam(growPayload);

  const portRegistryClient = new PortRegistryClient(ns, log);
  const schedulerResponsePort = await portRegistryClient.reservePort();
  const schedulerClient = new SchedulerClient(ns, log, schedulerResponsePort);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const capacity = await schedulerClient.capacity();
    const freeMemTotal = capacity.capacity.reduce(
      (acc, cur) => acc + cur.freeMem,
      0
    );
    const memTarget = Math.floor(freeMemTotal * 0.75);
    const threadTarget = Math.floor(memTarget / scriptmem);
    log.info("Starting full-grow", {
      host,
      scriptMem: fmt.memory(scriptmem),
      freeMemTotal: fmt.memory(freeMemTotal),
      memTarget: fmt.memory(memTarget),
      threadTarget,
    });

    {
      const { jobId, threads } = await schedulerClient.start({
        script: growPayload,
        args: [host],
        threads: threadTarget,
      });
      if (threads === 0) {
        log.info("Failed to start grow batch, sleeping then trying again");
        await ns.sleep(1000);
        continue;
      }
      log.info("Grow started", { jobId, threads });
      await schedulerClient.waitForJobFinished(jobId);
      log.info("Grow done");
    }

    if (
      ns.getServerSecurityLevel(host) >
      ns.getServerMinSecurityLevel(host) + 30
    ) {
      const { jobId, threads } = await schedulerClient.start({
        script: weakenPayload,
        args: [host],
        threads: threadTarget,
      });
      if (threads === 0) {
        log.info("Failed to start weaken batch /shrug");
        await ns.sleep(1000);
      }
      log.info("Weaken started", { jobId, threads });
      await schedulerClient.waitForJobFinished(jobId);
      log.info("Weaken done");
    }
  }
}

export function autocomplete(data: AutocompleteData): string[] {
  return data.servers;
}
