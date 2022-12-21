import { NS, NetscriptPort } from "@ns";
import { findPortMessage, supervisorEvents } from "./ports";

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

  constructor(ns: NS) {
    this.port = supervisorEvents(ns);
  }

  public async batchDone(batchId: string): Promise<void> {
    this.port.write(
      JSON.stringify({ type: "batch-done", payload: { batchId } })
    );
  }

  public async batchStarted(
    requestId: string,
    batchId: string,
    threads: number
  ): Promise<void> {
    this.port.write(
      JSON.stringify({
        type: "batch-started",
        payload: { requestId, batchId, threads },
      })
    );
  }

  public async waitForBatchStarted(
    requestId: string
  ): Promise<{ batchId: string; threads: number }> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const message = findPortMessage(this.port, (data) => {
        const message = JSON.parse(data.toString()) as SupervisorEvent;
        return (
          message.type === "batch-started" &&
          message.payload.requestId === requestId
        );
      });
      if (message) {
        const parsed = JSON.parse(message.toString()) as BatchStarted;
        return {
          batchId: parsed.payload.batchId,
          threads: parsed.payload.threads,
        };
      }
      await this.port.nextWrite();
    }
  }

  public async waitForBatchDone(batchId: string): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const message = findPortMessage(this.port, (data) => {
        const message = JSON.parse(data.toString()) as SupervisorEvent;
        return (
          message.type === "batch-done" && message.payload.batchId === batchId
        );
      });
      if (message) {
        return;
      }
      await this.port.nextWrite();
    }
  }
}
