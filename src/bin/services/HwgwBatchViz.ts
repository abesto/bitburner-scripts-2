import { NS } from '@ns';

import { Log } from '/log';
import { HwgwBatchVizService } from '/services/HwgwBatchViz/service';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "HwgwBatchViz");

  ns.tail();
  await ns.sleep(0);
  ns.moveTail(58, 0);
  ns.resizeTail(1355, 1240);
  ns.atExit(() => {
    ns.closeTail();
  });

  const service = new HwgwBatchVizService(ns, log);
  await service.listen();
}
