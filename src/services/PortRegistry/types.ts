import { ADT } from 'ts-adt';

export const SERVICE_ID = "PortRegistry";
export type ServiceTag = { service: typeof SERVICE_ID };
export const SERVICE_TAG: ServiceTag = { service: SERVICE_ID };

export type PortReqistryRequest$Exit = ServiceTag;

export type PortRegistryRequest$Status = ServiceTag & {
  responsePort: number;
};

export type PortRegistryRequest$Reserve = ServiceTag & {
  port: number;
  hostname: string;
  pid: number;
};

export type PortRegistryRequest$Release = ServiceTag & {
  port: number;
  hostname: string;
  pid: number;
};

export type PortRegistryRequest = ADT<{
  exit: PortReqistryRequest$Exit;
  reserve: PortRegistryRequest$Reserve;
  release: PortRegistryRequest$Release;
  status: PortRegistryRequest$Status;
}>;

export function isPortRegistryRequest(x: unknown): x is PortRegistryRequest {
  return (
    typeof x === "object" &&
    x !== null &&
    "service" in x &&
    x.service === SERVICE_ID
  );
}

export function toPortRegistryRequest(x: unknown): PortRegistryRequest | null {
  if (isPortRegistryRequest(x)) {
    return x;
  } else {
    return null;
  }
}

export function exitRequest(): PortRegistryRequest {
  return { _type: "exit", ...SERVICE_TAG };
}

export function reserveRequest(
  port: number,
  hostname: string,
  pid: number
): PortRegistryRequest {
  return { _type: "reserve", port, hostname, pid, ...SERVICE_TAG };
}

export function releaseRequest(
  port: number,
  hostname: string,
  pid: number
): PortRegistryRequest {
  return { _type: "release", port, hostname, pid, ...SERVICE_TAG };
}

export function statusRequest(responsePort: number): PortRegistryRequest {
  return { _type: "status", responsePort, ...SERVICE_TAG };
}

export type PortRegistryResponse$Status = ServiceTag & {
  status: "ok";
  reserved: Array<{ port: number; hostname: string; pid: number }>;
  free: Array<number>;
  freeHigh: number;
};

export type PortRegistryResponse = ADT<{
  status: PortRegistryResponse$Status;
}>;

export function isPortRegistryResponse(x: unknown): x is PortRegistryResponse {
  return (
    typeof x === "object" &&
    x !== null &&
    "service" in x &&
    x.service === SERVICE_ID
  );
}

export function toPortRegistryResponse(
  x: unknown
): PortRegistryResponse | null {
  if (isPortRegistryResponse(x)) {
    return x;
  } else {
    return null;
  }
}

export function statusResponse(
  reserved: Array<{ port: number; hostname: string; pid: number }>,
  free: Array<number>,
  freeHigh: number
): PortRegistryResponse {
  return {
    _type: "status",
    status: "ok",
    reserved,
    free,
    freeHigh,
    ...SERVICE_TAG,
  };
}
