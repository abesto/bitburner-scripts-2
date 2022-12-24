import { ADT } from "ts-adt";
import {
  ServiceTag,
  JobId,
  Job,
  Capacity,
  SERVICE_ID,
  SERVICE_TAG,
  ServiceState,
  ServiceStatus,
} from ".";

export type SchedulerResponse = ADT<{
  status: SchedulerResponse$Status;
  capacity: SchedulerResponse$Capacity;

  start: SchedulerResponse$Start;
  killJob: SchedulerResponse$KillJob;

  jobFinished: SchedulerResponse$JobFinished;

  reload: SchedulerResponse$Reload;
  serviceStatus: SchedulerResponse$ServiceStatus;
  startService: SchedulerResponse$StartService;
}>;

export function isSchedulerResponse(obj: unknown): obj is SchedulerResponse {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "service" in obj &&
    obj.service === SERVICE_ID
  );
}

export function toSchedulerResponse(obj: unknown): SchedulerResponse | null {
  if (isSchedulerResponse(obj)) {
    return obj;
  } else {
    return null;
  }
}

export type SchedulerResponse$Status = ServiceTag & {
  jobs: Job[];
  services: ServiceState[];
};
export function statusResponse(
  jobs: Job[],
  services: ServiceState[]
): SchedulerResponse {
  return { _type: "status", jobs, services, ...SERVICE_TAG };
}

export type SchedulerResponse$Capacity = ServiceTag & {
  capacity: Capacity[];
};
export function capacityResponse(capacity: Capacity[]): SchedulerResponse {
  return { _type: "capacity", capacity, ...SERVICE_TAG };
}

export type SchedulerResponse$Start = ServiceTag & {
  jobId: JobId;
  threads: number;
};
export function startResponse(
  jobId: JobId,
  threads: number
): SchedulerResponse {
  return { _type: "start", jobId, threads, ...SERVICE_TAG };
}

export type SchedulerResponse$JobFinished = ServiceTag & {
  jobId: JobId;
};
export function jobFinishedNotification(jobId: JobId): SchedulerResponse {
  return { _type: "jobFinished", jobId, ...SERVICE_TAG };
}

export type SchedulerResponse$KillJob = ServiceTag & {
  result: "ok" | "not-found";
};
export function killJobResponse(result: "ok" | "not-found"): SchedulerResponse {
  return { _type: "killJob", result, ...SERVICE_TAG };
}

export type SchedulerResponse$Reload = ServiceTag & {
  discovered: string[];
  removed: string[];
};
export function reloadResponse(
  discovered: string[],
  removed: string[]
): SchedulerResponse {
  return { _type: "reload", discovered, removed, ...SERVICE_TAG };
}

export type SchedulerResponse$ServiceStatus = ServiceTag & {
  payload: ADT<{
    ok: { state: ServiceState; logs: string[] };
    error: { kind: "not-found" };
  }>;
};
export function serviceStatusResponseOk(
  state: ServiceState,
  logs: string[]
): SchedulerResponse {
  return {
    _type: "serviceStatus",
    payload: { _type: "ok", state, logs },
    ...SERVICE_TAG,
  };
}
export function serviceStatusResponseNotFound(): SchedulerResponse {
  return {
    _type: "serviceStatus",
    payload: { _type: "error", kind: "not-found" },
    ...SERVICE_TAG,
  };
}

export type SchedulerResponse$StartService = ServiceTag & {
  payload: ADT<{
    ok: { status: ServiceStatus };
    error: { kind: "already-running" | "not-found" | "failed-to-start" };
  }>;
};
export function startServiceResponseOk(
  status: ServiceStatus
): SchedulerResponse {
  return {
    _type: "startService",
    payload: { _type: "ok", status },
    ...SERVICE_TAG,
  };
}
export function startServiceResponseAlreadyRunning(): SchedulerResponse {
  return {
    _type: "startService",
    payload: { _type: "error", kind: "already-running" },
    ...SERVICE_TAG,
  };
}
export function startServiceResponseNotFound(): SchedulerResponse {
  return {
    _type: "startService",
    payload: { _type: "error", kind: "not-found" },
    ...SERVICE_TAG,
  };
}
export function startServiceResponseFailedToStart(): SchedulerResponse {
  return {
    _type: "startService",
    payload: { _type: "error", kind: "failed-to-start" },
    ...SERVICE_TAG,
  };
}
