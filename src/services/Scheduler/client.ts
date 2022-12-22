import { NS } from "@ns";
import { refinement } from "ts-adt";
import { ClientPort, ServerPort } from "/services/common";
import { PORTS } from "/ports";

import {
  JobId,
  JobSpec,
  killJobRequest,
  SchedulerRequest,
  SchedulerResponse,
  SchedulerResponse$KillJob,
  SchedulerResponse$Start,
  SERVICE_ID as SCHEDULER,
  startRequest,
  taskFinishedRequest,
  TaskId,
  toSchedulerResponse,
} from "/services/Scheduler/types";
import { PortRegistryClient } from "../PortRegistry/client";

export class NoResponseSchedulerClient {
  protected readonly schedulerPort: ClientPort<SchedulerRequest>;

  constructor(ns: NS) {
    this.schedulerPort = new ClientPort(ns, PORTS[SCHEDULER]);
  }

  async taskFinished(jobId: JobId, taskId: TaskId): Promise<void> {
    const request = taskFinishedRequest(jobId, taskId);
    await this.schedulerPort.write(request);
    // No response expected.
  }
}

export class SchedulerClient extends NoResponseSchedulerClient {
  private readonly responsePort: ServerPort<SchedulerResponse>;

  constructor(ns: NS, private readonly responsePortNumber: number) {
    super(ns);
    this.responsePort = new ServerPort(
      ns,
      responsePortNumber,
      toSchedulerResponse
    );
  }

  async start(
    spec: JobSpec,
    tail: boolean,
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
