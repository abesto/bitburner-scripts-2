import { augmented, fields, TypeNames, variantModule, VariantOf } from 'variant';

import { JobId } from '../Scheduler/types';

export const SERVICE_ID = "HwgwBatchViz";
export type ServiceTag = { service: typeof SERVICE_ID };
export const SERVICE_TAG: ServiceTag = { service: SERVICE_ID };

export type JobKind = "hack" | "grow" | "hack-weaken" | "grow-weaken";

export const HwgwBatchVizRequest = variantModule(
  augmented(() => ({ ...SERVICE_TAG }), {
    plan: fields<{
      jobId: JobId;
      kind: JobKind;
      plannedStart: number;
      plannedEnd: number;
    }>(),

    start: fields<{
      timestamp: number;
      jobId: JobId;
      kind: JobKind;
    }>(),

    finished: fields<{ jobId: JobId; kind: JobKind; timestamp: number }>(),
  })
);

export type HwgwBatchVizRequest<
  T extends TypeNames<typeof HwgwBatchVizRequest> = undefined
> = VariantOf<typeof HwgwBatchVizRequest, T>;
