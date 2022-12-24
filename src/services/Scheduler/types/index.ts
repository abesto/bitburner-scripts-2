import { ADT } from "ts-adt";

export * from "./request";
export * from "./response";

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
  mustRunOn: { host: string };
  preferToRunOn: { host: string };
}>;

export type ServiceSpec = {
  name: string; // script is /bin/services/${name}.js
  hostAffinity?: HostAffinity;
};

export type ServiceStatus = ADT<{
  new: { _type: "new" };
  running: { pid: number; hostname: string; startedAt: number };
  stopped: {
    pid: number;
    hostname: string;
    startedAt: number;
    stoppedAt: number;
  };
  crashed: {
    pid: number;
    hostname: string;
    startedAt: number;
    crashedAt: number;
  };
}>;

export type ServiceState = {
  spec: ServiceSpec;
  enabled: boolean;
  status: ServiceStatus;
};

export const SERVICE_ID = "Scheduler";
export type ServiceTag = { service: typeof SERVICE_ID };
export const SERVICE_TAG: ServiceTag = { service: SERVICE_ID };
