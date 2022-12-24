import { NS } from '@ns';

import { Fmt } from '/fmt';
import { withSchedulerClient } from '/services/Scheduler/client';

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([["mem", 0]]);
  const fmt = new Fmt(ns);

  const targetMemory = args.mem as number;
  if (targetMemory <= 0) {
    throw new Error("Usage: run share.js --mem <memory>");
  }
  const script = "/bin/payloads/share.js";
  const scriptMem = ns.getScriptRam(script);
  const targetThreads = Math.floor(targetMemory / scriptMem);
  ns.print(
    `Running ${script} with ${targetThreads} threads, each using ${fmt.memory(
      scriptMem
    )} RAM, for a total of ${fmt.memory(targetThreads * scriptMem)} RAM`
  );

  await withSchedulerClient(ns, async (schedulerClient) => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { jobId, threads } = await schedulerClient.start({
        script,
        args: [],
        threads: targetThreads,
      });
      ns.print(`Job ${jobId} started with ${threads} threads`);
      await schedulerClient.waitForJobFinished(jobId);
      ns.print(`Job ${jobId} finished`);
    }
  });
}
