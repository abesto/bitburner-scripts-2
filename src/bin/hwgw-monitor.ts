import { NS } from "@ns";

import { DB } from "/database";
import { Fmt } from "/fmt";
import * as layout from "/layout";
import { Log } from "/log";
import { db } from "/services/Database/client";
import { PortRegistryClient } from "/services/PortRegistry/client";
import * as agg from "/services/Stats/agg";
import { StatsClient } from "/services/Stats/client";
import { Sparkline } from "/services/Stats/Sparkline";
import * as transform from "/services/Stats/transform";
import { AGG_MAP, TSEvent } from "/services/Stats/types";

export async function main(ns: NS): Promise<void> {
  const flags = ns.flags([
    ["job", ""],
    ["task", ""],
    ["overview", false],
  ]);

  const log = new Log(ns, "hwgw-monitor");
  let host = (flags._ as string[])[0];
  const overview = flags.overview as boolean;
  if (!overview && !host) {
    throw new Error("missing host");
  }
  if (overview) {
    host = "n00dles";
  }

  await layout.hwgwMonitor(ns);

  let lastRun;
  const monitor = await Monitor.new(ns, log, host);
  const memdb = await db(ns, log);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    lastRun = Date.now();
    const t0 = memdb.config.hwgw.spacing;
    const moneyThreshold = memdb.config.hwgw.moneyThreshold;
    try {
      if (overview) {
        await monitor.reportOverview({ t0, moneyThreshold });
      } else {
        await monitor.reportHost({
          t0,
          moneyThreshold,
        });
      }
    } catch (e) {
      if (e instanceof Error) {
        log.error("Error", { message: e.message, stack: e.stack });
      } else {
        log.error("Error", { message: e });
      }
    }
    const nextRun = lastRun + t0;
    await ns.sleep(Math.max(0, nextRun - Date.now()));
  }
}

class Monitor {
  private readonly fmt: Fmt;
  private now: number = Date.now();

  private readonly sparklines: {
    money: Sparkline;
    hackedAmount: Sparkline;
    security: Sparkline;
    threads: Sparkline;
    schedulerLatency: Sparkline;
    capacityUsed: Sparkline;
  };

  constructor(
    private readonly ns: NS,
    private readonly log: Log,
    private readonly host: string,
    private readonly maxMoney: number,
    private readonly minSecurity: number,
    private readonly stats: StatsClient,
    private readonly sparklineWidth = 70
  ) {
    this.log = log;
    this.fmt = new Fmt(ns);

    this.sparklines = {
      money: new Sparkline(this.ns, {
        width: sparklineWidth,
        agg: agg.min,
        format: this.fmt.moneyShort.bind(this.fmt),
        valueMin: 0,
        valueMax: this.maxMoney,
      }),
      hackedAmount: new Sparkline(this.ns, {
        width: sparklineWidth,
        agg: agg.sum,
        format: this.fmt.moneyShort.bind(this.fmt),
        valueMin: 0,
      }),

      security: new Sparkline(this.ns, {
        width: sparklineWidth,
        agg: agg.max,
        valueMin: this.minSecurity,
        valueMax: 100,
        format: this.fmt.int.bind(this.fmt),
      }).warn
        .ge(this.minSecurity + 10)
        .crit.gt(this.minSecurity + 30),

      threads: new Sparkline(this.ns, {
        width: sparklineWidth,
        agg: agg.sum,
        valueMin: 0,
        format: this.fmt.int.bind(this.fmt),
      }),

      schedulerLatency: new Sparkline(this.ns, {
        width: sparklineWidth,
        agg: agg.avg,
        valueMin: 0,
        format: this.fmt.timeMs.bind(this.fmt),
      }).warn
        .gt(100)
        .crit.gt(300),

      capacityUsed: new Sparkline(this.ns, {
        width: sparklineWidth,
        agg: agg.avg,
        valueMin: 0,
        valueMax: 100,
        format: this.fmt.int.bind(this.fmt),
      }).warn
        .ge(80)
        .crit.gt(90),
    };
  }

  static async new(ns: NS, log: Log, host: string): Promise<Monitor> {
    const maxMoney = ns.getServerMaxMoney(host);
    const minSecurity = ns.getServerMinSecurityLevel(host);
    const portRegistry = new PortRegistryClient(ns, log);
    const statsResponsePort = await portRegistry.reservePort();
    return new Monitor(
      ns,
      log,
      host,
      maxMoney,
      minSecurity,
      new StatsClient(ns, log, statsResponsePort),
      70
    );
  }

  protected recordThreads(memdb: DB): void {
    const threads = {
      hack: 0,
      grow: 0,
      weaken: 0,
    };
    for (const job of Object.values(memdb.scheduler.jobs)) {
      for (const kind of ["hack", "grow", "weaken"] as const) {
        if (
          job.spec.script === `bin/payloads/${kind}.js` &&
          job.spec.args[0] === this.host
        ) {
          threads[kind] += job.spec.threads;
        }
      }
    }

    for (const [kind, count] of Object.entries(threads)) {
      this.stats.record(`hwgw.${this.host}.${kind}`, count);
    }
  }

  protected async record(): Promise<void> {
    const memdb = await db(this.ns, this.log);
    this.stats.record(
      `server.${this.host}.money`,
      this.ns.getServerMoneyAvailable(this.host)
    );
    this.stats.record(
      `server.${this.host}.security`,
      this.ns.getServerSecurityLevel(this.host)
    );
    this.recordThreads(memdb);
    this.stats.record("player.money", this.ns.getPlayer().money);
  }

  async fetch(
    metric: string,
    t0: number,
    agg?: keyof typeof AGG_MAP
  ): Promise<TSEvent[] | "not-found"> {
    const getAgg = agg ? { bucketLength: t0, agg } : "none";
    const timeMax = this.now;
    const timeMin = timeMax - t0 * this.sparklineWidth;
    return transform.fillWithZeros(
      await this.stats.get(metric, getAgg, timeMin),
      timeMin,
      timeMax,
      t0
    );
  }

  render(
    metric: string,
    title: string,
    data: TSEvent[] | "not-found",
    sparkline: Sparkline,
    t0: number
  ): void {
    if (data === "not-found") {
      this.log.error("Metric not found", { metric });
    } else {
      this.ns.printf(
        "%s",
        sparkline.render(
          { name: title, events: data },
          {
            resolution: t0,
            timeMax: this.now,
            timeMin: this.now - t0 * this.sparklineWidth,
          }
        )
      );
    }
  }

  async reportOverview(input: { t0: number; moneyThreshold: number }) {
    this.now = Date.now();

    const latency = await this.fetch("scheduler.latency.p95", input.t0, "avg");
    const capacity = await this.fetch(
      "scheduler.capacity.usedPct",
      input.t0,
      "avg"
    );
    const incomes: [string, TSEvent[] | "not-found"][] = [];
    let totalIncome: TSEvent[] | "not-found" = "not-found";
    for (const seriesName of await this.stats.listSeries("hack.")) {
      const seriesData = await this.fetch(seriesName, input.t0, "sum");
      totalIncome = transform.sum(totalIncome, seriesData);
      incomes.push([seriesName, seriesData]);
    }

    this.ns.clearLog();

    const kw: { [key: string]: string | number } = {
      t0: this.fmt.timeSeconds(input.t0),
      moneyThreshold: this.fmt.float(input.moneyThreshold),
    };
    this.log.info("Stalefish", kw);

    this.render(
      "scheduler.latency.p95",
      "P95 Scheduler Latency",
      latency,
      this.sparklines.schedulerLatency,
      input.t0
    );

    this.render(
      "scheduler.capacity.usedPct",
      "Capacity Used %",
      capacity,
      this.sparklines.capacityUsed,
      input.t0
    );

    this.ns.printf("\n\n");

    for (const [seriesName, seriesData] of incomes) {
      this.render(
        seriesName,
        seriesName.split(".")[1] + " income",
        seriesData,
        this.sparklines.hackedAmount,
        input.t0
      );
    }

    this.ns.printf("\n\n");

    this.render(
      "hack.total",
      "Total income",
      totalIncome,
      this.sparklines.hackedAmount,
      input.t0
    );
  }

  async reportHost(input: { t0: number; moneyThreshold: number }) {
    await this.record();
    this.now = Date.now();

    const threads = {
      hack: await this.fetch(`hwgw.${this.host}.hack`, input.t0),
      weaken: await this.fetch(`hwgw.${this.host}.weaken`, input.t0),
      grow: await this.fetch(`hwgw.${this.host}.grow`, input.t0),
    };
    const money = await this.fetch(`server.${this.host}.money`, input.t0);
    const hackedAmount = await this.fetch(`hack.${this.host}`, input.t0);
    const security = await this.fetch(`server.${this.host}.security`, input.t0);
    const schedulerLatency = {
      avg: await this.fetch("scheduler.latency.avg", input.t0, "avg"),
      p95: await this.fetch("scheduler.latency.p95", input.t0, "avg"),
    };
    const capacityUsed = await this.fetch(
      "scheduler.capacity.usedPct",
      input.t0,
      "avg"
    );
    this.ns.clearLog();

    const positive = transform.max(0);
    const negative = transform.min(0);

    const kw: { [key: string]: string | number } = {
      t0: this.fmt.timeSeconds(input.t0),
      moneyThreshold: this.fmt.float(input.moneyThreshold),
      maxMoney: this.fmt.money(this.maxMoney),
    };
    this.log.info("Stalefish", kw);

    // Money
    this.render(
      `server.${this.host}.money`,
      "Server Money",
      money,
      this.sparklines.money.warn
        .lt(this.maxMoney * input.moneyThreshold)
        .crit.le(this.maxMoney * input.moneyThreshold ** 2),
      input.t0
    );
    this.render(
      `hack.${this.host}`,
      "Hack Income",
      hackedAmount,
      this.sparklines.hackedAmount,
      input.t0
    );
    this.ns.printf("\n\n");

    // Security
    this.render(
      `server.${this.host}.security`,
      "Server Security",
      security,
      this.sparklines.security,
      input.t0
    );
    this.ns.printf("\n\n");

    // Threads
    const derivatives = {
      hack: transform.derivative(threads.hack),
      weaken: transform.derivative(threads.weaken),
      grow: transform.derivative(threads.grow),
    };

    // Started
    for (const kind of ["hack", "weaken", "grow"] as const) {
      this.render(
        `hwgw.${this.host}.${kind}`,
        kind + " started",
        positive(derivatives[kind]),
        this.sparklines.threads,
        input.t0
      );
    }
    this.ns.printf("\n\n");

    // Finished
    for (const kind of ["hack", "weaken", "grow"] as const) {
      this.render(
        `hwgw.${this.host}.${kind}`,
        kind + " finished",
        transform.negate(negative(derivatives[kind])),
        this.sparklines.threads,
        input.t0
      );
    }
    this.ns.printf("\n\n");

    // Running
    for (const kind of ["hack", "weaken", "grow"] as const) {
      this.render(
        `hwgw.${this.host}.${kind}`,
        kind + " running",
        threads[kind],
        this.sparklines.threads,
        input.t0
      );
    }
    this.ns.printf("\n\n");

    // Scheduler latency
    this.render(
      "scheduler.latency.avg",
      "AVG Scheduler Latency",
      schedulerLatency.avg,
      this.sparklines.schedulerLatency,
      input.t0
    );
    this.render(
      "scheduler.latency.p95",
      "P95 Scheduler Latency",
      schedulerLatency.p95,
      this.sparklines.schedulerLatency,
      input.t0
    );

    // Capacity used
    this.render(
      "scheduler.capacity.usedPct",
      "Capacity Used %",
      capacityUsed,
      this.sparklines.capacityUsed,
      input.t0
    );
  }
}
