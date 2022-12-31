# Service Conventions

I've found it helpful to split code related to services into four modules:

* `services/NAME/types.ts`: the request and response types of the service, plus any further public types that are exposed
* `services/NAME/client.ts`: the client for the service, obviously. This is _the only way_ of talking to the service.
* `services/NAME/service.ts`: the service implementation
* `bin/services/NAME.ts`: a small binary to execute the service&#x20;

## Service ID

Each service has a unique string identifier, plus a `ServiceTag` type for merging into request / response objects. This is used to verify that the request/respose got to the service / client that it was intended for (see [services-common-baseclient.md](libraries/services-common-baseclient.md "mention") and [services-common-baseservice.md](libraries/services-common-baseservice.md "mention"))

```typescript
export const SERVICE_ID = "PortRegistry";
export type ServiceTag = { service: typeof SERVICE_ID };
export const SERVICE_TAG: ServiceTag = { service: SERVICE_ID };
```

## Request / Response Types

End of the day, a request or response is just a plain old JavaScript object. All the magic is there to ensure correctness using mostly type safety and some runtime checks, plus to make working with the types ergonomic.

For most of this project the fact that I'm using TypeScript is almost irrelevant; this is the one part where it's crucial. I depend heavily on the amazing [`variant`](https://paarthenon.github.io/variant/docs/intro) library. With it, defining a request type looks like this:

```typescript
export const PortRegistryRequest = variantModule(
  augmented(() => SERVICE_TAG, {
    exit: fields<Record<string, never>>(),
    status: fields<{ responsePort: number }>(),
    reserve: fields<{ port: number; hostname: string; pid: number }>(),
    release: fields<{ port: number; hostname: string; pid: number }>(),
  })
);

/* -- Boilerplate below -- */
export type PortRegistryRequest<
  T extends TypeNames<typeof PortRegistryRequest> = undefined
> = VariantOf<typeof PortRegistryRequest, T>;
```

This enables some pretty amazing magic, like:

* `PortRegistryRequest<"status">` is a type, and it expands to `{ service: "PortRegistry"; responsePort: number }`
* You can create new instances super easily: `PortRegistryRequest.status({ responsePort: 123 })`.
* `variant.match` is a great tool for pattern-matching against a variant
