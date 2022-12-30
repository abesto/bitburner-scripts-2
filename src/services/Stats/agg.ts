import { eventTime, eventValue, Time, TSEvent, Value } from './types';

export type Agg = (values: Value[]) => Value;

export function sum(values: Value[]): Value {
  return values.reduce((a, b) => a + b, 0);
}

export function avg(values: Value[]): Value {
  return sum(values) / values.length;
}

export function min(values: Value[]): Value {
  return Math.min(...values);
}

export function max(values: Value[]): Value {
  return Math.max(...values);
}

export function count(values: Value[]): Value {
  return values.length;
}

export function last(values: Value[]): Value {
  return values[values.length - 1];
}

export function percentile(p: number, values: Value[]): Value {
  const sorted = values.sort();
  const index = Math.floor(p * sorted.length);
  return sorted[index];
}

export const p99 = percentile.bind(null, 0.99);
export const p95 = percentile.bind(null, 0.95);

export function rebucket(
  events: TSEvent[],
  agg: Agg,
  bucketLength: Time
): TSEvent[] {
  const buckets: TSEvent[] = [];
  let bucketStart = 0;
  let bucketEnd = 0;
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
