import { NS } from '@ns';

import { Log } from '/log';
import { withClient } from '/services/client_factory';
import { DatabaseClient } from '/services/Database/client';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "db");

  if (ns.args.length === 0) {
    log.terror("Usage: db <command> [args]");
    return;
  }

  const command = ns.args[0] as string;
  if (command === "status") {
    await withClient(DatabaseClient, ns, log, async (client) => {
      const status = await client.status();
      log.tinfo("Database Status", { status });
    });
  } else {
    log.terror("Unknown command", { command });
  }
}
