import { NS } from '@ns';

import { NoResponseSchedulerClient } from '/services/Scheduler/client';

export async function main(ns: NS): Promise<void> {
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
      `ERROR Usage: run weaken.js <host> --job <jobId> --task <taskId>\nGot: ${JSON.stringify(
        args
      )}`
    );
    await new NoResponseSchedulerClient(ns).taskFinished(jobId, taskId);
    return;
  }
  const weakened = await ns.weaken(host);
  // TODO report weakened
  await new NoResponseSchedulerClient(ns).taskFinished(jobId, taskId);
}
