import { augmented, fields, TypeNames, variantModule, VariantOf } from 'variant';

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
export type PortRegistryResponse<
  T extends TypeNames<typeof PortRegistryResponse> = undefined
> = VariantOf<typeof PortRegistryResponse, T>;
