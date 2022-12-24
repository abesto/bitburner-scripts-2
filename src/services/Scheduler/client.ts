/* eslint-disable no-constant-condition */
import { NS } from "@ns";
import { refinement } from "ts-adt";
import { ClientPort, ServerPort } from "/services/common";
import { PORTS } from "/ports";

import {
  exitRequest,
  JobId,
  JobSpec,
  killAllRequest,
  killJobRequest,
  SchedulerRequest,
  SchedulerResponse,
  SchedulerResponse$KillJob,
  SchedulerResponse$Start,
  SchedulerResponse$Status,
  statusRequest,
  SERVICE_ID as SCHEDULER,
  startRequest,
  taskFinishedRequest,
  TaskId,
  toSchedulerResponse,
  SchedulerResponse$Capacity,
  capacityRequest,
  SchedulerResponse$Reload,
  reloadRequest,
  SchedulerResponse$ServiceStatus,
  serviceStatusRequest,
  startServiceRequest,
  SchedulerResponse$StartService,
  SchedulerResponse$StopService,
  stopServiceRequest,
} from "/services/Scheduler/types";
import { PortRegistryClient } from "../PortRegistry/client";

export class NoResponseSchedulerClient {
  protected readonly schedulerPort: ClientPort<SchedulerRequest>;

  constructor(protected readonly ns: NS) {
    this.schedulerPort = new ClientPort(ns, PORTS[SCHEDULER]);
  }

  async taskFinished(
    jobId: JobId,
    taskId: TaskId,
    crash = false
  ): Promise<void> {
    const request = taskFinishedRequest(jobId, taskId, crash);
    await this.schedulerPort.write(request);
  }

  async exit(): Promise<void> {
    await this.schedulerPort.write(exitRequest());
  }

  async killAll(): Promise<void> {
    await this.schedulerPort.write(killAllRequest());
  }

  async startServiceNoResponse(name: string): Promise<void> {
    const request = startServiceRequest(name, null);
    await this.schedulerPort.write(request);
  }
}

export class SchedulerClient extends NoResponseSchedulerClient {
  private readonly responsePort: ServerPort<SchedulerResponse>;

  constructor(ns: NS, readonly responsePortNumber: number) {
    super(ns);
    this.responsePort = new ServerPort(
      ns,
      responsePortNumber,
      toSchedulerResponse
    );
  }

  async start(
    spec: JobSpec,
    tail = false,
    finishNotificationPort: undefined | null | number = undefined
  ): Promise<SchedulerResponse$Start> {
    const request = startRequest(
      spec,
      tail,
      this.responsePortNumber,
      finishNotificationPort
    );
    await this.schedulerPort.write(request);
    const response = await this.responsePort.read();
    // TODO this part should be factored out, but the typing is tricky.
    if (response === null) {
      throw new Error("Invalid response");
    }
    if (refinement("start")(response)) {
      return response;
    } else {
      throw new Error(`Invalid response: ${JSON.stringify(response)}`);
    }
  }

  async waitForJobFinished(jobId: JobId): Promise<void> {
    const response = await this.responsePort.read();
    if (response === null) {
      throw new Error("Invalid response");
    }
    if (refinement("jobFinished")(response)) {
      if (response.jobId === jobId) {
        return;
      } else {
        throw new Error(`Unexpected jobId: ${response.jobId}`);
      }
    } else {
      throw new Error(`Invalid response: ${JSON.stringify(response)}`);
    }
  }

  async status(): Promise<SchedulerResponse$Status> {
    const request = statusRequest(this.responsePortNumber);
    await this.schedulerPort.write(request);
    const response = await this.responsePort.read();
    // TODO this part should be factored out, but the typing is tricky.
    if (response === null) {
      throw new Error("Invalid response");
    }
    if (refinement("status")(response)) {
      return response;
    } else {
      throw new Error(`Invalid response: ${JSON.stringify(response)}`);
    }
  }

  async capacity(): Promise<SchedulerResponse$Capacity> {
    const request = capacityRequest(this.responsePortNumber);
    await this.schedulerPort.write(request);
    const response = await this.responsePort.read();
    // TODO this part should be factored out, but the typing is tricky.
    if (response === null) {
      throw new Error("Invalid response");
    }
    if (refinement("capacity")(response)) {
      return response;
    } else {
      throw new Error(`Invalid response: ${JSON.stringify(response)}`);
    }
  }

  async killJob(jobId: JobId): Promise<SchedulerResponse$KillJob> {
    const request = killJobRequest(jobId, this.responsePortNumber);
    await this.schedulerPort.write(request);
    const response = await this.responsePort.read();
    // TODO this part should be factored out, but the typing is tricky.
    if (response === null) {
      throw new Error("Invalid response");
    }
    if (refinement("killJob")(response)) {
      return response;
    } else {
      throw new Error(`Invalid response: ${JSON.stringify(response)}`);
    }
  }

  async reload(): Promise<SchedulerResponse$Reload> {
    const request = reloadRequest(this.responsePortNumber);
    await this.schedulerPort.write(request);
    const response = await this.responsePort.read();
    // TODO this part should be factored out, but the typing is tricky.
    if (response === null) {
      throw new Error("Invalid response");
    }
    if (refinement("reload")(response)) {
      return response;
    } else {
      throw new Error(`Invalid response: ${JSON.stringify(response)}`);
    }
  }

  async serviceStatus(name: string): Promise<SchedulerResponse$ServiceStatus> {
    const request = serviceStatusRequest(name, this.responsePortNumber);
    await this.schedulerPort.write(request);
    const response = await this.responsePort.read();
    // TODO this part should be factored out, but the typing is tricky.
    if (response === null) {
      throw new Error("Invalid response");
    }
    if (refinement("serviceStatus")(response)) {
      return response;
    } else {
      throw new Error(`Invalid response: ${JSON.stringify(response)}`);
    }
  }

  async startService(name: string): Promise<SchedulerResponse$StartService> {
    const request = startServiceRequest(name, this.responsePortNumber);
    await this.schedulerPort.write(request);
    const response = await this.responsePort.read();
    // TODO this part should be factored out, but the typing is tricky.
    if (response === null) {
      throw new Error("Invalid response");
    }
    if (refinement("startService")(response)) {
      return response;
    } else {
      throw new Error(`Invalid response: ${JSON.stringify(response)}`);
    }
  }

  async stopService(name: string): Promise<SchedulerResponse$StopService> {
    const request = stopServiceRequest(name, this.responsePortNumber);
    await this.schedulerPort.write(request);
    const response = await this.responsePort.read();
    // TODO this part should be factored out, but the typing is tricky.
    if (response === null) {
      throw new Error("Invalid response");
    }
    if (refinement("stopService")(response)) {
      return response;
    } else {
      throw new Error(`Invalid response: ${JSON.stringify(response)}`);
    }
  }
}

export async function withSchedulerClient<T>(
  ns: NS,
  fn: (client: SchedulerClient) => Promise<T>
): Promise<T> {
  const portRegistryClient = new PortRegistryClient(ns);
  const port = await portRegistryClient.reservePort();
  const client = new SchedulerClient(ns, port);
  const retval = await fn(client);
  await portRegistryClient.releasePort(port);
  return retval;
}
