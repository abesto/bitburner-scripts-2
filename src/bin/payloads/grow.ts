import { NS } from "@ns";

import { Log } from "/log";
import { NoResponseSchedulerClient } from "/services/Scheduler/client";

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "grow");
  const args = ns.flags([
    ["job", ""],
    ["task", -1],
  ]);
  const jobId = args.job as string;
  const taskId = args.task as number;
  const posArgs = args._ as string[];
  const host = posArgs[0] as string;

  if (!host || typeof host !== "string" || !jobId || taskId < 0) {
    ns.tprint(
      `ERROR Usage: run grow.js <host> --job <jobId> --task <taskId>\nGot: ${JSON.stringify(
        args
      )}`
    );
    await new NoResponseSchedulerClient(ns, log).taskFinished(jobId, taskId);
    return;
  }
  log.debug(`Growing ${host}`);
  await ns.grow(host);
  log.debug(`Finished growing ${host}`);
  // TODO report mult
  await new NoResponseSchedulerClient(ns, log).taskFinished(jobId, taskId);
}
