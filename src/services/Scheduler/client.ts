import { NS } from '@ns';

import minimist from 'minimist';

import { Log } from '/log';
import { PORTS } from '/ports';
import { JobId, JobSpec, SERVICE_ID as SCHEDULER, TaskId } from '/services/Scheduler/types';

import { BaseClient } from '../common/BaseClient';
import { BaseNoResponseClient } from '../common/BaseNoResponseClient';
import { id } from '../common/Result';
import { PortRegistryClient } from '../PortRegistry/client';
import { SchedulerRequest as Request } from './types/request';
import { SchedulerResponse as Response, toSchedulerResponse } from './types/response';

function schedulerParent(ns: NS): { jobId: JobId; taskId: TaskId } | undefined {
  // minimist because `ns.flags` throws on unexpected flags
  const args = minimist(ns.args.map((arg) => arg.toString()));
  const jobId = args.job;
  const taskId = args.task;

  if (jobId !== undefined && taskId !== undefined) {
    return { jobId, taskId: parseInt(taskId, 10) };
  }
  return undefined;
}

export class NoResponseSchedulerClient extends BaseNoResponseClient<Request> {
  requestPortNumber(): number {
    return PORTS[SCHEDULER];
  }

  taskFinished(jobId: JobId, taskId: TaskId, crash = false): Promise<void> {
    return this.send(Request.taskFinished({ jobId, taskId, crash }));
  }

  exit(): Promise<void> {
    return this.send(Request.exit({}));
  }

  killAll(): Promise<void> {
    return this.send(Request.killAll({}));
  }

  startServiceNoResponse(serviceName: string): Promise<void> {
    return this.send(
      Request.startService({
        serviceName,
        responsePort: null,
      })
    );
  }
}

export class SchedulerClient extends BaseClient<Request, Response> {
  private readonly schedulerParent?: { jobId: JobId; taskId: TaskId };

  constructor(
    ns: NS,
    log: Log,
    responsePortNumber: number,
    portRegistryClient?: PortRegistryClient
  ) {
    super(ns, log, responsePortNumber, portRegistryClient);
    this.schedulerParent = schedulerParent(ns);
  }

  requestPortNumber(): number {
    return PORTS[SCHEDULER];
  }

  parseResponse(response: unknown): Response | null {
    return toSchedulerResponse(response);
  }

  start(
    spec: JobSpec,
    options?: {
      tail?: boolean;
      finishNotificationPort?: number | null;
      nohup?: boolean;
    }
  ): Promise<Response<"start">> {
    const tail = options?.tail ?? false;
    const finishNotificationPort =
      options?.finishNotificationPort === undefined
        ? this.responsePort.portNumber
        : options.finishNotificationPort;
    const nohup = options?.nohup ?? false;

    if (
      !nohup &&
      this.schedulerParent !== undefined &&
      spec.parent === undefined
    ) {
      spec.parent = this.schedulerParent;
    }

    return this.sendReceive(
      Request.start({
        spec,
        tail,
        finishNotificationPort,
        ...this.rp(),
      }),
      {
        start: id,
      }
    );
  }

  async waitForJobFinished(jobId: JobId): Promise<void> {
    const response = await this.responsePort.read({ timeout: 0 });
    await this.handleResponse(response, {
      jobFinished: (data) => {
        if (data.jobId !== jobId) {
          throw new Error(`Unexpected jobId: ${data.jobId}`);
        }
      },
    });
  }

  status(): Promise<Response<"status">> {
    return this.sendReceive(Request.status(this.rp()), {
      status: id,
    });
  }

  capacity(): Promise<Response<"capacity">> {
    return this.sendReceive(Request.capacity(this.rp()), {
      capacity: id,
    });
  }

  killJob(jobId: JobId): Promise<Response<"killJob">> {
    return this.sendReceive(Request.killJob({ jobId, ...this.rp() }), {
      killJob: id,
    });
  }

  tailTask(jobId: JobId, taskId: TaskId = 0): Promise<Response<"tailTask">> {
    return this.sendReceive(Request.tailTask({ jobId, taskId, ...this.rp() }), {
      tailTask: id,
    });
  }

  reload(): Promise<Response<"reload">> {
    return this.sendReceive(Request.reload({ ...this.rp() }), {
      reload: id,
    });
  }

  async serviceStatus(serviceName: string): Promise<Response<"serviceStatus">> {
    return this.sendReceive(
      Request.serviceStatus({ serviceName, ...this.rp() }),
      {
        serviceStatus: id,
      }
    );
  }

  startService(serviceName: string): Promise<Response<"startService">> {
    return this.sendReceive(
      Request.startService({ serviceName, ...this.rp() }),
      {
        startService: id,
      }
    );
  }

  stopService(serviceName: string): Promise<Response<"stopService">> {
    return this.sendReceive(
      Request.stopService({ serviceName, ...this.rp() }),
      {
        stopService: id,
      }
    );
  }

  enableService(serviceName: string): Promise<Response<"enableService">> {
    return this.sendReceive(
      Request.enableService({ serviceName, ...this.rp() }),
      {
        enableService: id,
      }
    );
  }

  disableService(serviceName: string): Promise<Response<"disableService">> {
    return this.sendReceive(
      Request.disableService({ serviceName, ...this.rp() }),
      {
        disableService: id,
      }
    );
  }

  tailService(serviceName: string): Promise<Response<"tailService">> {
    return this.sendReceive(
      Request.tailService({ serviceName, ...this.rp() }),
      {
        tailService: id,
      }
    );
  }
}
