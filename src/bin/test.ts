import { NS } from '@ns';

import { Fmt } from '/fmt';
import { Log } from '/log';
import { withClient } from '/services/client_factory';
import { DatabaseClient, dbLock } from '/services/Database/client';
import { avg, min, p95 } from '/services/Stats/agg';
import { StatsClient } from '/services/Stats/client';
import { Sparkline } from '/services/Stats/Sparkline';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "test");

  const fmt = new Fmt(ns);
  await withClient(StatsClient, ns, new Log(ns, "test"), async (client) => {
    ns.tprint(await client.listSeries());
    const timeMax = Date.now();
    const vizResolution = 750;
    const width = 70;
    const timeMin = timeMax - width * vizResolution;

    const data = await client.get(
      "server.megacorp.money",
      //{ bucketLength: 1000, agg: "avg" },
      "none",
      timeMin
    );
    if (data === "not-found") {
      ns.tprint("metric not found");
      return;
    }
    ns.tprint("count: ", data.length);
    ns.tprint(JSON.stringify(data));
    const sparkline = new Sparkline(ns, {
      width,
      agg: min,
      format: fmt.float.bind(fmt),
      resolution: vizResolution,
      valueMin: 0,
      valueMax: ns.getServerMaxMoney("megacorp"),
    });
    ns.tprintf(
      "%s",
      sparkline.render(
        { name: "test", events: data },
        { resolution: vizResolution, timeMin, timeMax }
      )
    );

    /*
    for (const [time, value] of data) {
      log.tdebug("data", {
        time: fmt.timestamp(time),
        value: fmt.float(value),
      });
    }
    */
  });

  log.tdebug("p95", { p95: p95([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) });
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
