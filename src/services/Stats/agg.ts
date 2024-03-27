import { eventTime, eventValue, Time, TSEvent, Value } from "./types";

export type Agg = (values: Value[]) => Value;

export function sum(values: Value[]): Value {
  return values.reduce((a, b) => a + b, 0);
}

export function avg(values: Value[]): Value {
  return sum(values) / values.length || 0;
}

export function min(values: Value[]): Value {
  return Math.min(...values) || 0;
}

export function max(values: Value[]): Value {
  return Math.max(...values) || 0;
}

export function count(values: Value[]): Value {
  return values.length;
}

export function last(values: Value[]): Value {
  return values[values.length - 1];
}

export function percentile(p: number, values: Value[]): Value {
  values.sort();
  const index = Math.floor(p * values.length);
  return values[index] || 0;
}

export const p99 = percentile.bind(null, 0.99);
export const p95 = percentile.bind(null, 0.95);

export function rebucket(
  events: TSEvent[],
  agg: Agg,
  bucketLength: Time
): TSEvent[] {
  if (!events.length) return [];
  const buckets: TSEvent[] = [];
  const timeMin = eventTime(events[0]);
  const timeMax = eventTime(events[events.length - 1]);
  let eventIndex = 0;
  for (let time = timeMin; time <= timeMax; time += bucketLength) {
    const bucketValues: Value[] = [];
    while (
      eventIndex < events.length &&
      Math.abs(eventTime(events[eventIndex]) - time) <
        Math.abs(eventTime(events[eventIndex]) - (time + bucketLength))
    ) {
      bucketValues.push(eventValue(events[eventIndex]));
      eventIndex++;
    }
    buckets.push([time, agg(bucketValues)]);
  }
  return buckets;
}

/*
export function rebucket(
  events: TSEvent[],
  agg: Agg,
  bucketLength: Time
): TSEvent[] {
  if (!events.length) return [];
  const buckets: TSEvent[] = [];
  let bucketStart = eventTime(events[0]) - bucketLength / 2;
  let bucketEnd = bucketStart + bucketLength;
  const bucketValues: Value[] = [];
  for (const event of events) {
    const time = eventTime(event);
    const value = eventValue(event);
    if (time >= bucketEnd) {
      if (bucketValues.length) {
        buckets.push([
          bucketStart,
          agg(bucketValues.splice(0, bucketValues.length)),
        ]);
      }
      bucketStart = time;
      bucketEnd = time + bucketLength;
    }
    bucketValues.push(value);
  }
  return buckets;
}
*/
