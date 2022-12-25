import {
    augmented, fields, isOfVariant, payload, TypeNames, variantModule, VariantOf
} from 'variant';

import { result } from '/services/common/Result';

import { Capacity, Job, JobId, SERVICE_ID, SERVICE_TAG, ServiceState, ServiceStatus } from './';

export const SchedulerResponse = variantModule(
  augmented(() => SERVICE_TAG, {
    status: fields<{ jobs: Job[]; services: ServiceState[] }>(),
    capacity: fields<{ capacity: Capacity[] }>(),

    start: fields<{ jobId: JobId; threads: number }>(),
    killJob: fields<{ result: "ok" | "not-found" }>(),

    jobFinished: fields<{ jobId: JobId }>(),

    reload: fields<{
      discovered: string[];
      updated: string[];
      removed: string[];
    }>(),
    serviceStatus: result<
      { state: ServiceState; logs: string[] },
      "not-found"
    >(),
    startService: result<
      ServiceStatus,
      "already-running" | "not-found" | "failed-to-start"
    >(),
    stopService: payload<"ok" | "not-found" | "not-running" | "kill-failed">(),
    enableService: payload<"ok" | "not-found" | "already-enabled">(),
    disableService: payload<"ok" | "not-found" | "already-disabled">(),
  })
);

/* -- Boilerplate below -- */
export type SchedulerResponse<
  T extends TypeNames<typeof SchedulerResponse> = undefined
> = VariantOf<typeof SchedulerResponse, T>;

export function isSchedulerResponse(obj: unknown): obj is SchedulerResponse {
  return isOfVariant(obj, SchedulerResponse) && obj.service === SERVICE_ID;
}
export function toSchedulerResponse(obj: unknown): SchedulerResponse | null {
  if (isSchedulerResponse(obj)) {
    return obj;
  } else {
    return null;
  }
}
