import { eventTime, eventValue, TSEvent, Value } from "./types";

export function derivative(
  events: TSEvent[] | "not-found"
): TSEvent[] | "not-found" {
  if (events === "not-found") return events;
  if (events.length < 2) return events;

  const result: TSEvent[] = [];
  let lastValue = eventValue(events[0]);
  for (let i = 1; i < events.length; i++) {
    const value = eventValue(events[i]);
    result.push([eventTime(events[i]), value - lastValue]);
    lastValue = value;
  }
  return result;
}

export const max =
  (n: Value = -Infinity) =>
  (events: TSEvent[] | "not-found"): TSEvent[] | "not-found" => {
    if (events === "not-found") return events;
    return events.map(([time, value]) => [time, Math.max(value, n)]);
  };

export const min =
  (n: Value = Infinity) =>
  (events: TSEvent[] | "not-found"): TSEvent[] | "not-found" => {
    if (events === "not-found") return events;
    return events.map(([time, value]) => [time, Math.min(value, n)]);
  };

export function negate(
  events: TSEvent[] | "not-found"
): TSEvent[] | "not-found" {
  if (events === "not-found") return events;
  return events.map(([time, value]) => [time, -value]);
}

export function sum(
  a: TSEvent[] | "not-found",
  b: TSEvent[] | "not-found"
): TSEvent[] | "not-found" {
  if (a === "not-found" && b !== "not-found") return b;
  if (b === "not-found" && a !== "not-found") return a;
  a = a as TSEvent[];
  b = b as TSEvent[];

  const result: TSEvent[] = [];
  let ai = 0;
  let bi = 0;
  while (ai < a.length && bi < b.length) {
    const [at, av] = a[ai];
    const [bt, bv] = b[bi];
    if (at === bt) {
      result.push([at, av + bv]);
      ai++;
      bi++;
    } else if (at < bt) {
      result.push([at, av]);
      ai++;
    } else {
      result.push([bt, bv]);
      bi++;
    }
  }

  return result;
}

export function fillWithZeros(
  events: TSEvent[] | "not-found",
  timeMin: number,
  timeMax: number,
  resolution: number
): TSEvent[] | "not-found" {
  if (events === "not-found") return events;
  const result: TSEvent[] = [];
  let ei = 0;
  for (let time = timeMin; time <= timeMax; time += resolution) {
    if (ei < events.length && eventTime(events[ei]) <= time) {
      result.push(events[ei]);
      ei++;
    } else {
      result.push([time, 0]);
    }
  }
  return result;
}
