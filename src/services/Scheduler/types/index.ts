import { fields, TypeNames, variantModule, VariantOf } from 'variant';

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

export const HostAffinity = variantModule({
  mustRunOn: fields<{ host: string }>(),
  preferToRunOn: fields<{ host: string }>(),
});
export type HostAffinity<T extends TypeNames<typeof HostAffinity> = undefined> =
  VariantOf<typeof HostAffinity, T>;

export type ServiceSpec = {
  name: string; // script is /bin/services/${name}.js
  hostAffinity?: HostAffinity;
};

export const ServiceStatus = variantModule({
  new: {},
  running: fields<{ pid: number; hostname: string; startedAt: number }>(),
  stopped: fields<{
    pid: number;
    hostname: string;
    startedAt: number;
    stoppedAt: number;
  }>(),
  crashed: fields<{
    pid: number;
    hostname: string;
    startedAt: number;
    crashedAt: number;
  }>(),
});
export type ServiceStatus<
  T extends TypeNames<typeof ServiceStatus> = undefined
> = VariantOf<typeof ServiceStatus, T>;

export type ServiceState = {
  spec: ServiceSpec;
  enabled: boolean;
  status: ServiceStatus;
};

export const SERVICE_ID = "Scheduler";
export type ServiceTag = { service: typeof SERVICE_ID };
export const SERVICE_TAG: ServiceTag = { service: SERVICE_ID };
