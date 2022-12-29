import { NS } from '@ns';

import { discoverServers } from '/discoverServers';
import { Fmt } from '/fmt';
import HwgwEstimator from '/HwgwEstimator';
import { Log } from '/log';
import { db } from '/services/Database/client';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "target");
  const estimator = new HwgwEstimator(ns);

  const memdb = await db(ns, log);

  const data = [];
  for (const server of discoverServers(ns)) {
    const maxMoney = ns.getServerMaxMoney(server);
    if (maxMoney === 0 || ns.hackAnalyze(server) === 0) {
      continue;
    }
    const estimate = await estimator.stableMaxDepth(
      server,
      memdb.config.hwgw.moneyThreshold,
      memdb.config.simpleHack.moneyThreshold
    );
    data.push({
      server,
      maxMoney,
      ...estimate,
    });
  }

  data.sort((a, b) => b.moneyPerSec - a.moneyPerSec);

  const fmt = new Fmt(ns);
  for (const item of data.slice(0, 20)) {
    const requiredHackingLevel = ns.getServerRequiredHackingLevel(item.server);

    log.tinfo(item.server, {
      hackLevel: requiredHackingLevel,
      ...item,
      maxMoney: fmt.money(item.maxMoney),
      period: fmt.timeSeconds(item.period),
      peakRam: fmt.memory(item.peakRam),
      moneyPerSec: fmt.money(item.moneyPerSec),
    });
  }
}
