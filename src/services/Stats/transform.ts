import { eventTime, eventValue, TSEvent, Value } from './types';

export function derivative(events: TSEvent[]): TSEvent[] {
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
  (n: Value) =>
  (events: TSEvent[]): TSEvent[] => {
    return events.map(([time, value]) => [time, Math.max(value, n)]);
  };

export const min =
  (n: Value) =>
  (events: TSEvent[]): TSEvent[] => {
    return events.map(([time, value]) => [time, Math.min(value, n)]);
  };

export function negate(events: TSEvent[]): TSEvent[] {
  return events.map(([time, value]) => [time, -value]);
}
