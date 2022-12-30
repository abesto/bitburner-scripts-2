import { NS } from '@ns';

import { Fmt } from '/fmt';
import { Log } from '/log';
import { withClient } from '/services/client_factory';
import { DatabaseClient, dbLock } from '/services/Database/client';
import { avg } from '/services/Stats/agg';
import { Sparkline } from '/services/Stats/Sparkline';
import { TSEvent } from '/services/Stats/types';

export async function main(ns: NS): Promise<void> {
  const width = 60;
  const resolution = 1000;
  const sparkline = new Sparkline(ns, { width, agg: avg, resolution });
  sparkline.warn.gt(80);
  sparkline.crit.le(20);

  const events: TSEvent[] = [];
  const now = Date.now();
  for (let i = 0; i < width; i++) {
    events.push([now + i * resolution, Math.random() * 100]);
  }
  const ts = { name: "Test Series", events };

  ns.tprintf("%s", sparkline.render(ts));
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
