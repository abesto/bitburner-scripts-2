import { ADT } from 'ts-adt';

export const SERVICE_ID = "Database";
export type ServiceTag = { service: typeof SERVICE_ID };
export const SERVICE_TAG: ServiceTag = { service: SERVICE_ID };

export type DatabaseRequest = ADT<{
  read: DatabaseRequest$Read;
  lock: DatabaseRequest$Lock;
  unlock: DatabaseRequest$Unlock;
  writeAndUnlock: DatabaseRequest$WriteAndUnlock;
}>;

export function isDatabaseRequest(x: unknown): x is DatabaseRequest {
  return (
    typeof x === "object" &&
    x !== null &&
    "service" in x &&
    x.service === SERVICE_ID
  );
}

export function toDatabaseRequest(x: unknown): DatabaseRequest | null {
  if (isDatabaseRequest(x)) {
    return x;
  } else {
    return null;
  }
}

export type DatabaseRequest$Read = ServiceTag & { responsePort: number };
export function readRequest(responsePort: number): DatabaseRequest {
  return { _type: "read", responsePort, ...SERVICE_TAG };
}

export type LockData = {
  hostname: string;
  script: string;
  args: (string | number | boolean)[];
  pid: number;
  responsePort: number;
};

export type DatabaseRequest$Lock = ServiceTag & {
  lockData: LockData;
};
export function lockRequest(lockData: LockData): DatabaseRequest {
  return {
    _type: "lock",
    lockData,
    ...SERVICE_TAG,
  };
}

export type DatabaseRequest$Unlock = ServiceTag & {
  lockData: LockData;
};
export function unlockRequest(lockData: LockData): DatabaseRequest {
  return { _type: "unlock", lockData, ...SERVICE_TAG };
}

export type DatabaseRequest$WriteAndUnlock = ServiceTag & {
  lockData: LockData;
  content: string;
};
export function writeAndUnlockRequest(
  content: string,
  lockData: LockData
): DatabaseRequest {
  return {
    _type: "writeAndUnlock",
    content,
    lockData,
    ...SERVICE_TAG,
  };
}

export type DatabaseResponse = ADT<{
  read: DatabaseResponse$Read;
  lock: DatabaseResponse$Lock;
  unlock: DatabaseResponse$Unlock;
}>;

export function isDatabaseResponse(x: unknown): x is DatabaseResponse {
  return (
    typeof x === "object" &&
    x !== null &&
    "service" in x &&
    x.service === SERVICE_ID
  );
}

export function toDatabaseResponse(x: unknown): DatabaseResponse | null {
  if (isDatabaseResponse(x)) {
    return x;
  } else {
    return null;
  }
}

export type DatabaseResponse$Read = ServiceTag & { content: string };
export function readResponse(content: string): DatabaseResponse {
  return { _type: "read", content, ...SERVICE_TAG };
}

export type DatabaseResponse$Lock = ServiceTag & { content: string };
export function lockResponse(content: string): DatabaseResponse {
  return { _type: "lock", content, ...SERVICE_TAG };
}

export type UnlockResult = ADT<{
  ok: { _type: "ok" };
  error: { kind: "not-locked" | "locked-by-other" };
}>;

export type DatabaseResponse$Unlock = ServiceTag & { payload: UnlockResult };
export function unlockResponse(payload: UnlockResult): DatabaseResponse {
  return { _type: "unlock", payload, ...SERVICE_TAG };
}
export function unlockResponseOk(): DatabaseResponse {
  return unlockResponse({ _type: "ok" });
}
export function unlockResponseError(kind: "not-locked" | "locked-by-other") {
  return unlockResponse({ _type: "error", kind });
}
