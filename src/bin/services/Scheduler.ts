import { NS } from '@ns';

import { SchedulerService } from '/services/Scheduler/service';

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const scheduler = await SchedulerService.new(ns);
  await scheduler.listen();
}
