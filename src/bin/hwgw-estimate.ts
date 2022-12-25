import { AutocompleteData, NS } from '@ns';

import { db } from '/database';
import { Fmt } from '/fmt';
import HwgwEstimator from '/HwgwEstimator';
import { Log } from '/log';

export async function main(ns: NS): Promise<void> {
  const fmt = new Fmt(ns);
  const log = new Log(ns, "hwgw-estimate");
  const estimator = new HwgwEstimator(ns);

  const args = ns.flags([["money-threshold", 0]]);
  const host = (args._ as string[])[0];
  const moneyThresholdConfig = args["money-threshold"] as number;

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

  const stable = await estimator.stable(host, moneyThresholdConfig);
  log.tinfo("Stable hwgw", { ...stable, peakRam: fmt.memory(stable.peakRam) });
}

export function autocomplete(data: AutocompleteData, args: string[]): string[] {
  return data.servers;
}
