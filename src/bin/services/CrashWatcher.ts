// Watch for processes crashing that the Scheduler manages
import { NS } from '@ns';

import { Log } from '/log';
import { withClient } from '/services/client_factory';
import { NoResponseSchedulerClient, SchedulerClient } from '/services/Scheduler/client';

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
  const log = new Log(ns, "CrashWatcher");
  const reportingClient = new NoResponseSchedulerClient(ns, log);
  await withClient(SchedulerClient, ns, log, async (schedulerClient) => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const { jobs } = await schedulerClient.status();
        for (const job of jobs) {
          for (const task of Object.values(job.tasks)) {
            const process = ns.getRunningScript(task.pid);
            if (process === null) {
              log.info("Task crashed", { job, task });
              await reportingClient.taskFinished(job.id, task.id, true);
            } else if (
              process.filename !== job.spec.script ||
              arrayEqual(process.args, task.args)
            ) {
              log.info("Task changed script or args", { job, task, process });
              await reportingClient.taskFinished(job.id, task.id, true);
            }
          }
        }
      } catch (e: unknown) {
        if (e instanceof Error) {
          log.error("Error", { reason: e.message });
        } else {
          log.error("Error", { reason: e });
        }
      }
      await ns.sleep(5000);
    }
  });
}
