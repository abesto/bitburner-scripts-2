import { NS } from '@ns';

import { Log } from '/log';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "db");

  if (ns.args.length === 0) {
    log.terror("Usage: db <command> [args]");
    return;
  }
}
