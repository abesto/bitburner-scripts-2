import { NS } from '@ns';

import * as asciichart from 'asciichart';

import { Fmt } from '/fmt';
import { Log } from '/log';

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const fmt = new Fmt(ns);
  const log = new Log(ns, "money-per-sec");

  const collectInterval = 1000;
  const maxHistory = 12 * 3600 * 1000;
  const width = 60;

  let lastMoney = ns.getPlayer().money;
  const rawData = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const money = ns.getPlayer().money;
    rawData.push(Math.max(0, money - lastMoney));
    lastMoney = money;
    rawData.splice(
      maxHistory / collectInterval,
      rawData.length - maxHistory / collectInterval
    );

    const bucketSize = Math.ceil(rawData.length / width);
    // Calculate the average every bucketSize
    const timeseries = [];
    for (let i = 0; i < rawData.length; i += bucketSize) {
      const bucket = rawData.slice(i, i + bucketSize);
      timeseries.push(bucket.reduce((a, b) => a + b, 0) / bucket.length);
    }

    ns.clearLog();
    ns.printf(
      "%s",
      asciichart.plot(timeseries, {
        min: 0,
        height: 15,
        format: (x) => fmt.money(x).padStart(10),
      })
    );
    log.info("Stats", {
      avg: fmt.money(timeseries.reduce((a, b) => a + b, 0) / timeseries.length),
      min: fmt.money(Math.min(...timeseries)),
      max: fmt.money(Math.max(...timeseries)),
      last: fmt.money(timeseries[timeseries.length - 1]),
      ".": fmt.time(bucketSize * collectInterval),
    });
    await ns.sleep(collectInterval);
  }
}
