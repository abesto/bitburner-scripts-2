import { augmented, fields, isOfVariant, TypeNames, variantModule, VariantOf } from 'variant';

export const SERVICE_ID = "PortRegistry";
export type ServiceTag = { service: typeof SERVICE_ID };
export const SERVICE_TAG: ServiceTag = { service: SERVICE_ID };

export const PortRegistryRequest = variantModule(
  augmented(() => SERVICE_TAG, {
    exit: fields<Record<string, never>>(),
    status: fields<{ responsePort: number }>(),
    reserve: fields<{ port: number; hostname: string; pid: number }>(),
    release: fields<{ port: number; hostname: string; pid: number }>(),
  })
);

export const PortRegistryResponse = variantModule(
  augmented(() => SERVICE_TAG, {
    status: fields<{
      reserved: { port: number; hostname: string; pid: number }[];
      free: number[];
      freeHigh: number;
    }>(),
  })
);

/* -- Boilerplate below -- */

export type PortRegistryRequest<
  T extends TypeNames<typeof PortRegistryRequest> = undefined
> = VariantOf<typeof PortRegistryRequest, T>;

export function isPortRegistryRequest(x: unknown): x is PortRegistryRequest {
  return isOfVariant(x, PortRegistryRequest) && x.service === SERVICE_ID;
}
export function toPortRegistryRequest(x: unknown): PortRegistryRequest | null {
  if (isPortRegistryRequest(x)) {
    return x;
  } else {
    return null;
  }
}

export type PortRegistryResponse<
  T extends TypeNames<typeof PortRegistryResponse> = undefined
> = VariantOf<typeof PortRegistryResponse, T>;

export function isPortRegistryResponse(x: unknown): x is PortRegistryResponse {
  return isOfVariant(x, PortRegistryResponse) && x.service === SERVICE_ID;
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
