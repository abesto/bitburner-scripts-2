import { NS } from '@ns';

import { StatsService } from '/services/Stats/service';

export async function main(ns: NS): Promise<void> {
  const service = new StatsService(ns);
  await service.listen();
}
