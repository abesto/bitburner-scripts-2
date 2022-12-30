// Share a configured percentage of free capacity
import { NS } from '@ns';

import { Fmt } from '/fmt';
import { Log } from '/log';
import { withClient } from '/services/client_factory';
import { db } from '/services/Database/client';
import { SchedulerClient } from '/services/Scheduler/client';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "Share");
  const fmt = new Fmt(ns);
  const script = "/bin/payloads/share.js";
  const scriptMem = ns.getScriptRam(script);
  await withClient(SchedulerClient, ns, log, async (client) => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { capacity } = await client.capacity();
      const sumFreeMem = capacity.reduce(
        (sum, { freeMem }) => sum + freeMem,
        0
      );
      const memdb = await db(ns, log);
      const config = memdb.config.share;
      const percentage = config.percentage;
      const max = config.max ?? Infinity;

      if (percentage === 0 || percentage > 1) {
        log.twarn("Invalid percentage", { percentage });
        await ns.sleep(30000);
        continue;
      }

      const targetMem = Math.min(max, Math.floor(sumFreeMem * percentage));
      const targetThreads = Math.floor(targetMem / scriptMem);
      log.info("Sharing", {
        sumFreeMem: fmt.memory(sumFreeMem),
        percentage: fmt.percent(percentage),
        targetMem: fmt.memory(targetMem),
        targetThreads,
        scriptMem: fmt.memory(scriptMem),
      });
      const { jobId, threads } = await client.start({
        script,
        args: [],
        threads: targetThreads,
      });
      log.info("Started", { jobId, threads, targetThreads });
      await client.waitForJobFinished(jobId, {
        timeout: 30000,
        throwOnTimeout: false,
      });
      log.info("Finished", { jobId });
    }
  });
}
