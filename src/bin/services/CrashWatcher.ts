// Watch for processes crashing that the Scheduler manages
import { NS } from '@ns';

import { withSchedulerClient } from '/services/Scheduler/client';

function arrayEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  await withSchedulerClient(ns, async (schedulerClient) => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { jobs } = await schedulerClient.status();
      for (const job of jobs) {
        for (const task of Object.values(job.tasks)) {
          const process = ns.getRunningScript(task.pid);
          if (process === null) {
            ns.print(
              `Task ${job.id}:${task.id} ${job.spec.script} ${job.spec.args} on ${task.hostname} crashed`
            );
            await schedulerClient.taskFinished(job.id, task.id, true);
          } else if (
            process.filename !== job.spec.script ||
            arrayEqual(process.args, task.args)
          ) {
            ns.print(
              `Task ${task.id} changed script or arg: ${process.filename} ${process.args} -> ${job.spec.script} ${task.args}`
            );
            await schedulerClient.taskFinished(job.id, task.id, true);
          }
        }
      }
      await ns.sleep(5000);
    }
  });
}
