import { NS } from '@ns';

import { Log } from '/log';
import { withClient } from '/services/client_factory';
import { DatabaseClient, dbLock } from '/services/Database/client';
import { StatsClient } from '/services/Stats/client';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "test");
  await withClient(StatsClient, ns, log, async (client) => {
    const start = Date.now();
    log.tdebug("Sending");
    await client.record("a", 1);
    await client.record("a", 2);
    log.tdebug("Sleeping 1.5s");
    await ns.sleep(1500);
    log.tdebug("Sending more");
    await client.record("a", 3);
    await client.record("a.b", 1);
    await client.record("a.b", 40, "add");

    log.tdebug("Reading");
    log.tinfo("test!", {
      a: await client.getRaw("a"),
      b: await client.getRaw("a.b"),
      aSince: await client.getRaw("a", start),
      series: await client.listSeries(),
      seriesADot: await client.listSeries("a."),
    });
  });
}

export async function withoutClient(ns: NS): Promise<void> {
  const log = new Log(ns, "test");
  const times: number[] = [];
  let last = Date.now();

  for (let i = 0; i < 100; i++) {
    log.tdebug("waiting", { i });
    await dbLock(ns, log, async (memdb) => {
      const now = Date.now();
      times.push(now - last);
      last = now;
      return memdb;
    });
  }
  log.tinfo("done", {
    avg: times.reduce((a, b) => a + b, 0) / times.length,
    min: Math.min(...times),
    max: Math.max(...times),
  });
}

export async function testWithClient(ns: NS): Promise<void> {
  const log = new Log(ns, "test");
  const times: number[] = [];
  let last = Date.now();

  await withClient(DatabaseClient, ns, log, async (client) => {
    for (let i = 0; i < 100; i++) {
      log.tdebug("waiting", { i });
      await client.withLock(async (memdb) => {
        const now = Date.now();
        times.push(now - last);
        last = now;
        return memdb;
      });
    }
  });
  log.tinfo("done", {
    avg: times.reduce((a, b) => a + b, 0) / times.length,
    min: Math.min(...times),
    max: Math.max(...times),
  });
}
