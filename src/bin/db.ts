import { NS } from '@ns';

import { Log } from '/log';
import { PortRegistryClient } from '/services/PortRegistry/client';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "db");

  if (ns.args.length === 0) {
    log.terror("Usage: db <command> [args]");
    return;
  }

  const portRegistryClient = new PortRegistryClient(ns, log);
  const responsePort = await portRegistryClient.reservePort();

  const command = ns.args[0] as string;
  // TODO
}
