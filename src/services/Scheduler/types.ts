import { ADT } from "ts-adt";

export type JobId = string;
export type TaskId = number;

export type Capacity = {
  hostname: string;
  totalMem: number;
  freeMem: number;
  cores: number;
};

export type JobSpec = {
  script: string;
  args: string[];
  threads: number;
  hostAffinity?: HostAffinity;
};

export type Job = {
  id: JobId;
  spec: JobSpec;
  finishNotificationPort: number | null;
  tasks: { [taskId: TaskId]: Task };
};

export function jobThreads(job: Job): number {
  return Object.values(job.tasks).reduce((sum, task) => sum + task.threads, 0);
}

export type Task = {
  id: TaskId;
  hostname: string;
  args: string[]; // actual real args the script was invoked with
  pid: number;
  threads: number;
};

export type HostAffinity = ADT<{
  mustRunOn: string;
  preferToRunOn: string;
}>;

export const SERVICE_ID = "Scheduler";
export type ServiceTag = { service: typeof SERVICE_ID };
export const SERVICE_TAG: ServiceTag = { service: SERVICE_ID };

export type SchedulerRequest$Status = ServiceTag & { responsePort: number };
export type SchedulerRequest$Start = ServiceTag & {
  spec: JobSpec;
  tail: boolean;
  responsePort: number | null;
  finishNotificationPort: number | null;
};
export type SchedulerRequest$TaskFinished = ServiceTag & {
  jobId: JobId;
  taskId: TaskId;
};
export type SchedulerRequest$KillJob = ServiceTag & {
  jobId: JobId;
  responsePort: number;
};
export type SchedulerRequest = ADT<{
  status: SchedulerRequest$Status;
  start: SchedulerRequest$Start;
  taskFinished: SchedulerRequest$TaskFinished;
  killJob: SchedulerRequest$KillJob;
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

export function taskFinishedRequest(
  jobId: JobId,
  taskId: TaskId
): SchedulerRequest {
  return { _type: "taskFinished", jobId, taskId, ...SERVICE_TAG };
}

export function killJobRequest(
  jobId: JobId,
  responsePort: number
): SchedulerRequest {
  return { _type: "killJob", jobId, responsePort, ...SERVICE_TAG };
}

export type SchedulerResponse$Start = ServiceTag & {
  jobId: JobId;
  threads: number;
};
export type SchedulerResponse$JobFinished = ServiceTag & {
  jobId: JobId;
};
export type SchedulerResponse$KillJob = ServiceTag & {
  result: "ok" | "not-found";
};
export type SchedulerResponse = ADT<{
  start: SchedulerResponse$Start;
  jobFinished: SchedulerResponse$JobFinished;
  killJob: SchedulerResponse$KillJob;
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

export function startResponse(
  jobId: JobId,
  threads: number
): SchedulerResponse {
  return { _type: "start", jobId, threads, ...SERVICE_TAG };
}

export function jobFinishedNotification(jobId: JobId): SchedulerResponse {
  return { _type: "jobFinished", jobId, ...SERVICE_TAG };
}

export function killJobResponse(
  payload: SchedulerResponse$KillJob
): SchedulerResponse {
  return { _type: "killJob", ...payload, ...SERVICE_TAG };
}
