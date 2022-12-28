import { NS } from '@ns';

import { HwgwBatchVizService } from '/services/HwgwBatchViz/service';

export async function main(ns: NS): Promise<void> {
  ns.tail();
  await ns.sleep(0);
  ns.moveTail(58, 0);
  ns.resizeTail(1355, 1240);
  ns.atExit(() => {
    ns.closeTail();
  });

  const service = new HwgwBatchVizService(ns);
  await service.listen();
}
