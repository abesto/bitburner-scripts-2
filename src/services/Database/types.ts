import { augmented, fields, isOfVariant, TypeNames, variantModule, VariantOf } from 'variant';

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
    writeAndUnlock: fields<{ lockData: LockData; content: string }>(),
    status: fields<{ responsePort: number }>(),
  })
);

export type UnlockResult = "ok" | "not-locked" | "locked-by-other";
export const DatabaseResponse = variantModule(
  augmented(() => SERVICE_TAG, {
    read: fields<{ content: string }>(),
    lock: fields<{ content: string }>(),
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
export function isDatabaseRequest(x: unknown): x is DatabaseRequest {
  return isOfVariant(x, DatabaseRequest) && x.service === SERVICE_ID;
}
export function toDatabaseRequest(x: unknown): DatabaseRequest | null {
  if (isDatabaseRequest(x)) {
    return x;
  } else {
    return null;
  }
}

export type DatabaseResponse<
  T extends TypeNames<typeof DatabaseResponse> = undefined
> = VariantOf<typeof DatabaseResponse, T>;

export function isDatabaseResponse(x: unknown): x is DatabaseResponse {
  return isOfVariant(x, DatabaseResponse) && x.service === SERVICE_ID;
}

export function toDatabaseResponse(x: unknown): DatabaseResponse | null {
  if (isDatabaseResponse(x)) {
    return x;
  } else {
    return null;
  }
}
