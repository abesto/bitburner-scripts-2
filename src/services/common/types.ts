import { isOfVariant, VariantModule } from 'variant';
import { SumType } from 'variant/lib/variant';

export const isOfService =
  <V extends VariantModule>(V: V, serviceId: unknown) =>
  (x: unknown): x is SumType<V> => {
    return isOfVariant(x, V) && x.service === serviceId;
  };

export const toMessage =
  <V extends VariantModule>(V: V, serviceId: unknown) =>
  (x: unknown): SumType<V> | null => {
    if (isOfService(V, serviceId)(x)) {
      return x;
    } else {
      return null;
    }
  };
