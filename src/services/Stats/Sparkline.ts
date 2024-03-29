import { NS } from "@ns";

import * as colors from "colors";

import { Fmt, formatKeyvalue } from "/fmt";

import { Agg, avg, last, lastNonZero, max, min, p95, rebucket } from "./agg";
import { eventTime, eventValue, Series, Time, Value } from "./types";

const CHARS = "▁▂▃▄▅▆▇█" as const;

export class SparklineThreshold {
  readonly color: (s: string) => string;

  constructor(
    readonly kind: "ge" | "le" | "gt" | "lt",
    readonly level: "warn" | "crit",
    readonly value: Value
  ) {
    this.color = level === "warn" ? colors.darkYellow : colors.red;
  }

  isViolated(value: Value): boolean {
    switch (this.kind) {
      case "ge":
        return value >= this.value;
      case "le":
        return value <= this.value;
      case "gt":
        return value > this.value;
      case "lt":
        return value < this.value;
    }
  }
}

export interface SparklineConfig {
  width: number;
  agg: Agg;
  format?: (value: Value) => string;
  valueMin?: Value;
  valueMax?: Value;
  resolution?: Time;
}

export class Sparkline {
  private readonly thresholds: SparklineThreshold[] = [];
  private readonly fmt: Fmt;
  private readonly format: (value: Value) => string;

  constructor(ns: NS, private readonly config: SparklineConfig) {
    this.fmt = new Fmt(ns);
    this.format = config.format ?? this.fmt.float.bind(this.fmt);
  }

  withThreshold(threshold: SparklineThreshold): Sparkline {
    this.thresholds.push(threshold);
    return this;
  }

  get warn() {
    return {
      ge: (value: Value) =>
        this.withThreshold(new SparklineThreshold("ge", "warn", value)),
      le: (value: Value) =>
        this.withThreshold(new SparklineThreshold("le", "warn", value)),
      gt: (value: Value) =>
        this.withThreshold(new SparklineThreshold("gt", "warn", value)),
      lt: (value: Value) =>
        this.withThreshold(new SparklineThreshold("lt", "warn", value)),
    };
  }

  get crit() {
    return {
      ge: (value: Value) =>
        this.withThreshold(new SparklineThreshold("ge", "crit", value)),
      le: (value: Value) =>
        this.withThreshold(new SparklineThreshold("le", "crit", value)),
      gt: (value: Value) =>
        this.withThreshold(new SparklineThreshold("gt", "crit", value)),
      lt: (value: Value) =>
        this.withThreshold(new SparklineThreshold("lt", "crit", value)),
    };
  }

  private applyThresholds(value: Value, s: string): string {
    let ret = s;
    for (const threshold of this.thresholds) {
      if (threshold.isViolated(value)) {
        ret = threshold.color(s);
      }
    }
    return ret;
  }

  render(
    series: Series,
    renderConfig?: Partial<
      Exclude<SparklineConfig, { format: (n: number) => string }>
    > & { timeMin?: Time; timeMax?: Time }
  ): string {
    const config = { ...this.config, ...renderConfig };

    if (series.events.length === 0) {
      return `(${series.name}: NO DATA)\n(${series.name}: NO DATA)`;
    }
    const events = series.events;

    const times = events.map(eventTime);
    const timeMax = config.timeMax ?? Math.max(...times);
    const timeMin =
      config.timeMin ??
      (config?.resolution
        ? timeMax - config.width * config.resolution
        : Math.min(...times));
    const timeRange = timeMax - timeMin;

    const charLength = config.resolution ?? Math.ceil(timeRange / config.width);
    const buckets = rebucket(events, config.agg, charLength);

    const values = buckets.map(eventValue);
    const valueMin = config?.valueMin ?? Math.min(...values);
    const valueMax = config?.valueMax ?? Math.max(...values);
    const valueRange = valueMax - valueMin;

    let sparkline = new Array(config.width).fill(" ");
    for (const bucket of buckets) {
      const value = eventValue(bucket);
      const time = eventTime(bucket);
      const timeIndex = Math.round((time - timeMin) / charLength);
      const charIndex = Math.floor(
        ((value - valueMin) / valueRange) * (CHARS.length - 1)
      );
      sparkline[timeIndex] = this.applyThresholds(
        value,
        CHARS[charIndex] || " "
      );
    }
    if (sparkline.length < config.width) {
      sparkline = new Array(config.width - sparkline.length)
        .fill(" ")
        .concat(...sparkline);
    }

    const stats = formatKeyvalue({
      min: this.format(min(values)),
      avg: this.format(avg(values)),
      p95: this.format(p95(values)),
      max: this.format(max(values)),
    });

    const scale = formatKeyvalue({
      ".": this.fmt.timeSeconds(charLength),
      last: this.format(last(values)),
      lastNonZero: this.format(lastNonZero(values)),
    });

    const tsStart = this.fmt.timestamp(timeMin);
    const tsEnd = this.fmt.timestamp(timeMax);
    const tsSpace =
      config.width - tsStart.length - tsEnd.length - series.name.length;
    const tsLine =
      tsStart +
      " ".repeat(Math.max(1, Math.floor(tsSpace / 2))) +
      colors.white(series.name) +
      " ".repeat(Math.max(1, Math.ceil(tsSpace / 2))) +
      tsEnd;
    return sparkline.join("") + "   " + stats + "\n" + tsLine + "   " + scale;
  }
}
