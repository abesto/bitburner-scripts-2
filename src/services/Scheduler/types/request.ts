import { ADT } from "ts-adt";
import { JobId, JobSpec, ServiceTag, SERVICE_ID, SERVICE_TAG, TaskId } from ".";

export type SchedulerRequest = ADT<{
  // Manage the Scheduler itself
  status: SchedulerRequest$Status;
  capacity: SchedulerRequest$Capacity;
  exit: SchedulerRequest$Exit;

  // Job management
  start: SchedulerRequest$Start;
  killAll: SchedulerRequest$KillAll;
  killJob: SchedulerRequest$KillJob;

  // Report task results
  taskFinished: SchedulerRequest$TaskFinished;

  // Service management
  reload: SchedulerRequest$Reload;
  serviceStatus: SchedulerRequest$ServiceStatus;
  startService: SchedulerRequest$StartService;
  stopService: SchedulerRequest$StopService;
  restartService: SchedulerRequest$RestartService;
  enableService: SchedulerRequest$EnableService;
  disableService: SchedulerRequest$DisableService;
}>;

export function isSchedulerRequest(obj: unknown): obj is SchedulerRequest {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "service" in obj &&
    obj.service === SERVICE_ID
  );
}

export function toSchedulerRequest(obj: unknown): SchedulerRequest | null {
  if (isSchedulerRequest(obj)) {
    return obj;
  } else {
    return null;
  }
}

export type SchedulerRequest$Status = ServiceTag & { responsePort: number };
export function statusRequest(responsePort: number): SchedulerRequest {
  return { _type: "status", responsePort, ...SERVICE_TAG };
}

export type SchedulerRequest$Capacity = ServiceTag & { responsePort: number };
export function capacityRequest(responsePort: number): SchedulerRequest {
  return { _type: "capacity", responsePort, ...SERVICE_TAG };
}

export type SchedulerRequest$Exit = ServiceTag;
export function exitRequest(): SchedulerRequest {
  return { _type: "exit", ...SERVICE_TAG };
}

export type SchedulerRequest$Start = ServiceTag & {
  spec: JobSpec;
  tail: boolean;
  responsePort: number | null;
  finishNotificationPort: number | null;
};
export function startRequest(
  spec: JobSpec,
  tail: boolean,
  responsePort: number | null,
  finishNotificationPort: number | null | undefined = undefined
): SchedulerRequest {
  if (finishNotificationPort === undefined) {
    finishNotificationPort = responsePort;
  }
  return {
    _type: "start",
    spec,
    tail,
    responsePort,
    finishNotificationPort,
    ...SERVICE_TAG,
  };
}

export type SchedulerRequest$KillAll = ServiceTag;
export function killAllRequest(): SchedulerRequest {
  return { _type: "killAll", ...SERVICE_TAG };
}

export type SchedulerRequest$KillJob = ServiceTag & {
  jobId: JobId;
  responsePort: number;
};
export function killJobRequest(
  jobId: JobId,
  responsePort: number
): SchedulerRequest {
  return { _type: "killJob", jobId, responsePort, ...SERVICE_TAG };
}

export type SchedulerRequest$TaskFinished = ServiceTag & {
  jobId: JobId;
  taskId: TaskId;
  crash: boolean;
};
export function taskFinishedRequest(
  jobId: JobId,
  taskId: TaskId,
  crash = false
): SchedulerRequest {
  return { _type: "taskFinished", jobId, taskId, crash, ...SERVICE_TAG };
}

export type SchedulerRequest$Reload = ServiceTag & { responsePort: number };
export function reloadRequest(responsePort: number): SchedulerRequest {
  return { _type: "reload", responsePort, ...SERVICE_TAG };
}

export type SchedulerRequest$ServiceStatus = ServiceTag & {
  serviceName: string;
  responsePort: number;
};
export function serviceStatusRequest(
  serviceName: string,
  responsePort: number
): SchedulerRequest {
  return { _type: "serviceStatus", serviceName, responsePort, ...SERVICE_TAG };
}

export type SchedulerRequest$StartService = ServiceTag & {
  serviceName: string;
  responsePort: number;
};
export function startServiceRequest(
  serviceName: string,
  responsePort: number
): SchedulerRequest {
  return { _type: "startService", serviceName, responsePort, ...SERVICE_TAG };
}

export type SchedulerRequest$StopService = ServiceTag & {
  serviceName: string;
  responsePort: number;
};
export function stopServiceRequest(
  serviceName: string,
  responsePort: number
): SchedulerRequest {
  return { _type: "stopService", serviceName, responsePort, ...SERVICE_TAG };
}

export type SchedulerRequest$EnableService = ServiceTag & {
  serviceName: string;
  responsePort: number;
};
export function enableServiceRequest(
  serviceName: string,
  responsePort: number
): SchedulerRequest {
  return { _type: "enableService", serviceName, responsePort, ...SERVICE_TAG };
}

export type SchedulerRequest$DisableService = ServiceTag & {
  serviceName: string;
  responsePort: number;
};
export function disableServiceRequest(
  serviceName: string,
  responsePort: number
): SchedulerRequest {
  return { _type: "disableService", serviceName, responsePort, ...SERVICE_TAG };
}

export type SchedulerRequest$RestartService = ServiceTag & {
  serviceName: string;
  responsePort: number;
};
export function restartServiceRequest(
  serviceName: string,
  responsePort: number
): SchedulerRequest {
  return { _type: "restartService", serviceName, responsePort, ...SERVICE_TAG };
}
