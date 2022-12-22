import { NS, NetscriptPort } from "@ns";
import { waitForMessage, supervisorEvents } from "./ports";

export type SupervisorEvent = BatchDone | BatchStarted;

type BatchDone = {
  type: "batch-done";
  payload: {
    batchId: string;
  };
};

type BatchStarted = {
  type: "batch-started";
  payload: {
    requestId: string;
    batchId: string;
    threads: number;
  };
};

export class SupervisorEvents {
  private port: NetscriptPort;
  private ns: NS;

  constructor(ns: NS) {
    this.port = supervisorEvents(ns);
    this.ns = ns;
  }

  public async batchDone(batchId: string): Promise<void> {
    if (
      this.port.write(
        JSON.stringify({
          type: "batch-done",
          timestamp: Date.now(),
          payload: { batchId },
        })
      ) !== null
    ) {
      this.ns.tprint("ERROR SuperviserEvent port is full");
    }
  }

  public async batchStarted(
    requestId: string,
    batchId: string,
    threads: number
  ): Promise<void> {
    if (
      this.port.write(
        JSON.stringify({
          type: "batch-started",
          timestamp: Date.now(),
          payload: { requestId, batchId, threads },
        })
      ) !== null
    ) {
      this.ns.tprint("ERROR SuperviserEvent port is full");
    }
  }

  public async waitForBatchStarted(
    requestId: string
  ): Promise<{ batchId: string; threads: number }> {
    const message = await waitForMessage(this.port, (data) => {
      const message = JSON.parse(data.toString()) as SupervisorEvent;
      return (
        message.type === "batch-started" &&
        message.payload.requestId === requestId
      );
    });
    const parsed = JSON.parse(message.toString()) as BatchStarted;
    return {
      batchId: parsed.payload.batchId,
      threads: parsed.payload.threads,
    };
  }

  public async waitForBatchStartedByBatchId(
    batchId: string
  ): Promise<{ batchId: string; threads: number }> {
    const message = await waitForMessage(this.port, (data) => {
      const message = JSON.parse(data.toString()) as SupervisorEvent;
      return (
        message.type === "batch-started" && message.payload.batchId === batchId
      );
    });
    const parsed = JSON.parse(message.toString()) as BatchStarted;
    return {
      batchId: parsed.payload.batchId,
      threads: parsed.payload.threads,
    };
  }

  public async waitForBatchDone(batchId: string): Promise<void> {
    await waitForMessage(this.port, (data) => {
      const message = JSON.parse(data.toString()) as SupervisorEvent;
      return (
        message.type === "batch-done" && message.payload.batchId === batchId
      );
    });
  }
}
