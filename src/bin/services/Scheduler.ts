import { NS } from '@ns';

import { SchedulerService } from '/services/Scheduler/service';

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const scheduler = new SchedulerService(ns);
  await scheduler.listen();
}
