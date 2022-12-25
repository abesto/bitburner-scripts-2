import { NS } from '@ns';

import { DatabaseService } from '/services/Database/service';

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const database = new DatabaseService(ns);
  await database.listen();
}
