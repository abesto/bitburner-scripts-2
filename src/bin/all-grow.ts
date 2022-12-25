import { AutocompleteData, NS } from '@ns';

import { Fmt } from '/fmt';
import { Log } from '/log';
import { PortRegistryClient } from '/services/PortRegistry/client';
import { SchedulerClient } from '/services/Scheduler/client';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "all-grow");
  const fmt = new Fmt(ns);

  const payload = "/bin/payloads/grow.js";
  const host = ns.args[0] as string;
  const scriptmem = ns.getScriptRam(payload);

  const portRegistryClient = new PortRegistryClient(ns, log);
  const schedulerResponsePort = await portRegistryClient.reservePort();
  const schedulerClient = new SchedulerClient(ns, log, schedulerResponsePort);

  const capacity = await schedulerClient.capacity();
  const freeMemTotal = capacity.capacity.reduce(
    (acc, cur) => acc + cur.freeMem,
    0
  );
  const memTarget = Math.floor(freeMemTotal * 0.9);
  const threadTarget = Math.floor(memTarget / scriptmem);

  log.info("Starting full-grow", {
    host,
    scriptMem: fmt.memory(scriptmem),
    freeMemTotal: fmt.memory(freeMemTotal),
    memTarget: fmt.memory(memTarget),
    threadTarget,
  });
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { jobId, threads } = await schedulerClient.start(
      {
        script: payload,
        args: [host],
        threads: threadTarget,
      },
      true
    );
    if (threads === 0) {
      log.info("Failed to start grow batch, sleeping then trying again");
      await ns.sleep(1000);
    }
    log.info("Batch started", { jobId, threads });
    await schedulerClient.waitForJobFinished(jobId);
  }
}

export function autocomplete(data: AutocompleteData): string[] {
  return data.servers;
}
