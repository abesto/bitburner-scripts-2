import { AutocompleteData, NS } from '@ns';

import { Fmt } from '/fmt';
import HwgwEstimator from '/HwgwEstimator';
import { Log } from '/log';
import { db } from '/services/Database/client';

export async function main(ns: NS): Promise<void> {
  const fmt = new Fmt(ns);
  const log = new Log(ns, "hwgw-estimate");
  const estimator = new HwgwEstimator(ns);

  const args = ns.flags([]);
  const host = (args._ as string[])[0];
  const memdb = await db(ns, log);

  if (!host) {
    log.terror(
      "Usage: run hwgw-estimate.js <host> [--money-threshold <money>]",
      { args }
    );
    return;
  }

  const initial = await estimator.initial(host);
  log.tinfo("Initial grow/weaken", {
    ...initial,
    ramRequirement: fmt.memory(initial.ramRequirement),
    batchLen: fmt.time(initial.batchLen),
  });
  log.tinfo(
    "Stable",
    await estimator.stableMaxDepth(host, moneyThresholdConfig)
  );
}

export function autocomplete(data: AutocompleteData): string[] {
  return data.servers;
}
