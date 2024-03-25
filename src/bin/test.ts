import { NS } from "@ns";

import { Fmt } from "/fmt";
import { Log } from "/log";
import { withClient } from "/services/client_factory";
import { DatabaseClient, dbLock } from "/services/Database/client";
import { avg, min, p95 } from "/services/Stats/agg";
import { StatsClient } from "/services/Stats/client";
import { Sparkline } from "/services/Stats/Sparkline";

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "test");
  const fmt = new Fmt(ns);
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
