import { genericVariant, GTypeNames, GVariantOf, payload } from 'variant';
import { Identity } from 'variant/lib/util';

const [_Result, __Result] = genericVariant(({ O, E }) => ({
  Ok: payload(O),
  Err: payload(E),
}));
export type Result<
  O,
  E,
  TType extends GTypeNames<typeof __Result> = undefined
> = GVariantOf<typeof __Result, TType, { O: O; E: E }>;
export const Result = _Result;

export const result =
  <O, E>() =>
  (
    input: { ok: Identity<NonNullable<O>> } | { err: Identity<NonNullable<E>> }
  ) => {
    if ("ok" in input) {
      return { result: Result.Ok(input.ok) };
    } else {
      return { result: Result.Err(input.err) };
    }
  };

export function id<T>(x: T): T {
  return x;
}
