import {
  augmented,
  fields,
  payload,
  TypeNames,
  variantModule,
  VariantOf,
} from "variant";

import { DB } from "/database";

export const SERVICE_ID = "Database";
export type ServiceTag = { service: typeof SERVICE_ID };
export const SERVICE_TAG: ServiceTag = { service: SERVICE_ID };

export type LockData = {
  hostname: string;
  script: string;
  args: (string | number | boolean)[];
  pid: number;
  responsePort: number;
};

export const DatabaseRequest = variantModule(
  augmented(() => SERVICE_TAG, {
    read: fields<{ responsePort: number }>(),
    lock: fields<{ lockData: LockData }>(),
    unlock: fields<{ lockData: LockData }>(),
    writeAndUnlock: fields<{ lockData: LockData; db: DB }>(),
    status: fields<{ responsePort: number }>(),
  })
);

export type UnlockResult = "ok" | "not-locked" | "locked-by-other";
export const DatabaseResponse = variantModule(
  augmented(() => SERVICE_TAG, {
    read: fields<{ db: DB }>(),
    lock: payload<"ack" | DB>(),
    lockDeferred: payload<DB>(),
    unlock: fields<{ result: UnlockResult }>(),
    writeAndUnlock: fields<{
      result: UnlockResult;
    }>(),
    status: fields<{ currentLock: LockData | null; lockQueue: LockData[] }>(),
  })
);

/* -- Boilerplate below -- */
export type DatabaseRequest<
  T extends TypeNames<typeof DatabaseRequest> = undefined
> = VariantOf<typeof DatabaseRequest, T>;
export type DatabaseResponse<
  T extends TypeNames<typeof DatabaseResponse> = undefined
> = VariantOf<typeof DatabaseResponse, T>;
