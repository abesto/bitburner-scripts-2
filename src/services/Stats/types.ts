import {
  augmented,
  fields,
  payload,
  TypeNames,
  variantModule,
  VariantOf,
} from "variant";

import { avg, count, max, min, p95, p99, sum } from "./agg";

export const SERVICE_ID = "Stats";
export type ServiceTag = { service: typeof SERVICE_ID };
export const SERVICE_TAG: ServiceTag = { service: SERVICE_ID };

export type Time = number;
export type Value = number;

export type TSEvent = [timestamp: Time, value: Value];
export const eventTime = (e: TSEvent) => e[0];
export const eventValue = (e: TSEvent) => e[1];
export type Series = { name: string; events: TSEvent[] };

export const AGG_MAP = {
  sum,
  avg,
  min,
  max,
  count,
  p99,
  p95,
} as const;

export type GetAgg = "none" | { bucketLength: Time; agg: keyof typeof AGG_MAP };

export const StatsRequest = variantModule(
  augmented(() => SERVICE_TAG, {
    record: fields<{
      series: string;
      event: TSEvent;
    }>(),
    listSeries: fields<{ responsePort: number; prefix?: string }>(),
    get: fields<{
      responsePort: number;
      series: string;
      agg: GetAgg;
      since?: Time;
    }>(),
  })
);

export const StatsResponse = variantModule(
  augmented(() => SERVICE_TAG, {
    listSeries: payload<string[]>(),
    get: payload<TSEvent[] | "not-found">(),
  })
);

/* -- Boilerplate below -- */
export type StatsRequest<T extends TypeNames<typeof StatsRequest> = undefined> =
  VariantOf<typeof StatsRequest, T>;
export type StatsResponse<
  T extends TypeNames<typeof StatsResponse> = undefined
> = VariantOf<typeof StatsResponse, T>;
