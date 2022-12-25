// CLI for PortRegistry
import { NS } from '@ns';

import { Log } from '/log';
import { PortRegistryClient } from '/services/PortRegistry/client';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "portc");

  const args = ns.flags([["seconds", 0]]);
  const posArgs = args._ as string[];
  const command = posArgs[0];

  const client = new PortRegistryClient(ns, log);

  if (command === "status") {
    const status = await client.status();
    log.tinfo("PortRegistry status", {
      freeHigh: status.freeHigh,
      reusable: status.free,
    });
    for (const { port, hostname, pid } of status.reserved) {
      const process = ns.ps(hostname).find((p) => p.pid === pid);
      const procStr = process
        ? `${process.filename} ${process.args.join(" ")}`
        : "(stopped)";
      log.tinfo("Reserved port", { port, hostname, pid, procStr });
    }
  } else if (command === "reserve") {
    const seconds = args.seconds as number;
    if (seconds <= 0) {
      log.terror("Invalid or missing --seconds");
      return;
    }
    const port = await client.reservePort();
    log.tinfo("Reserved port", { port, seconds });
    await ns.sleep(seconds * 1000);
    await client.releasePort(port);
    log.tinfo("Released port", { port });
  } else {
    log.terror("Unknown command", { command });
  }
}
