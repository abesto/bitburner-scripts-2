import { augmented, fields, payload, TypeNames, variantModule, VariantOf } from 'variant';

export const SERVICE_ID = "Stats";
export type ServiceTag = { service: typeof SERVICE_ID };
export const SERVICE_TAG: ServiceTag = { service: SERVICE_ID };

export type Time = number;
export type Value = number;

export type Event = [timestamp: Time, value: Value];
export type Series = { name: string; events: Event[] };

export const StatsRequest = variantModule(
  augmented(() => SERVICE_TAG, {
    record: fields<{
      series: string;
      event: Event;
      action: "overwrite" | "add";
    }>(),
    listSeries: fields<{ responsePort: number; prefix?: string }>(),
    getRaw: fields<{ responsePort: number; series: string; since?: Time }>(),
  })
);

export const StatsResponse = variantModule(
  augmented(() => SERVICE_TAG, {
    listSeries: payload<string[]>(),
    getRaw: payload<Event[] | "not-found">(),
  })
);

/* -- Boilerplate below -- */
export type StatsRequest<T extends TypeNames<typeof StatsRequest> = undefined> =
  VariantOf<typeof StatsRequest, T>;
export type StatsResponse<
  T extends TypeNames<typeof StatsResponse> = undefined
> = VariantOf<typeof StatsResponse, T>;
