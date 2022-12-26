import { NS } from '@ns';

import { Log } from '/log';
import { HwgwBatchVizService } from '/services/HwgwBatchViz/service';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "HwgwBatchViz");
  const scheduler = new HwgwBatchVizService(ns, log);
  await scheduler.listen();
}
