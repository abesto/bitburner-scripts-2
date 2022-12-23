import { NS } from "@ns";
import { NoResponseSchedulerClient } from "/services/Scheduler/client";

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([
    ["job", ""],
    ["task", -1],
  ]);
  const jobId = args.job as string;
  const taskId = args.task as number;

  if (!jobId || taskId < 0) {
    ns.tprint(
      `ERROR Usage: run share.js --job <jobId> --task <taskId>\nGot: ${JSON.stringify(
        args
      )}`
    );
    await new NoResponseSchedulerClient(ns).taskFinished(jobId, taskId);
    return;
  }
  await ns.share();
  await new NoResponseSchedulerClient(ns).taskFinished(jobId, taskId);
}
