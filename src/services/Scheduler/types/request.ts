import { augmented, fields, isOfVariant, TypeNames, variantModule, VariantOf } from 'variant';

import { JobId, JobSpec, SERVICE_ID, SERVICE_TAG, TaskId } from './';

export const SchedulerRequest = variantModule(
  augmented(() => SERVICE_TAG, {
    // Manage the Scheduler itself
    status: fields<{ responsePort: number }>(),
    capacity: fields<{ responsePort: number }>(),
    exit: fields<Record<string, never>>(),

    // Job management
    start: fields<{
      spec: JobSpec;
      tail: boolean;
      responsePort: number | null;
      finishNotificationPort: number | null;
    }>(),
    killAll: fields<Record<string, never>>(),
    killJob: fields<{ jobId: JobId; responsePort: number }>(),
    tailTask: fields<{ jobId: JobId; taskId: number; responsePort: number }>(),

    // Report task results
    taskFinished: fields<{ jobId: JobId; taskId: TaskId; crash: boolean }>(),

    // Service management
    reload: fields<{ responsePort: number }>(),
    serviceStatus: fields<{ serviceName: string; responsePort: number }>(),
    startService: fields<{
      serviceName: string;
      responsePort: number | null;
    }>(),
    stopService: fields<{ serviceName: string; responsePort: number }>(),
    enableService: fields<{ serviceName: string; responsePort: number }>(),
    disableService: fields<{ serviceName: string; responsePort: number }>(),
    tailService: fields<{ serviceName: string; responsePort: number }>(),
  })
);

/* -- Boilerplate below -- */

export type SchedulerRequest<
  T extends TypeNames<typeof SchedulerRequest> = undefined
> = VariantOf<typeof SchedulerRequest, T>;
export function isSchedulerRequest(obj: unknown): obj is SchedulerRequest {
  return isOfVariant(obj, SchedulerRequest) && obj.service === SERVICE_ID;
}
export function toSchedulerRequest(obj: unknown): SchedulerRequest | null {
  if (isSchedulerRequest(obj)) {
    return obj;
  } else {
    return null;
  }
}
