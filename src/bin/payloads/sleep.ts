import { NS } from "@ns";
import { NoResponseSchedulerClient } from "/services/Scheduler/client";

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([
    ["job", ""],
    ["task", -1],
  ]);
  const jobId = args.job as string;
  const taskId = args.task as number;
  const posArgs = args._ as string[];
  const time = parseInt(posArgs[0] as string, 10);

  if (isNaN(time) || !jobId || taskId < 0) {
    ns.tprint(
      `ERROR Usage: run sleep.js <seconds> --job <jobId> --task <taskId>\nGot: ${JSON.stringify(
        args
      )}`
    );
    await new NoResponseSchedulerClient(ns).taskFinished(jobId, taskId);
    return;
  }
  await ns.sleep(parseInt(ns.args[0] as string, 10));
  await new NoResponseSchedulerClient(ns).taskFinished(jobId, taskId);
}
