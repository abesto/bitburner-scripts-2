import { NS, NetscriptPort } from "@ns";

import { supervisorControl } from "/ports";

export type Message =
  | { type: "echo"; payload: string }
  | { type: "status" }
  | { type: "exit" }
  | {
      type: "start";
      payload: {
        script: string;
        args: string[];
        threads: number;
        requestId: string;
      };
    }
  | { type: "finished"; payload: { pid: number; hostname: string } }
  | { type: "tail-daemon" };

// TODO do something useful if the queue is full

export class SupervisorCtl {
  private port: NetscriptPort;

  constructor(ns: NS) {
    this.port = supervisorControl(ns);
  }

  public async echo(payload: string): Promise<void> {
    this.port.write(JSON.stringify({ type: "echo", payload }));
  }

  public async status(): Promise<void> {
    this.port.write(JSON.stringify({ type: "status" }));
  }

  public async exit(): Promise<void> {
    this.port.write(JSON.stringify({ type: "exit" }));
  }

  public async start(
    script: string,
    args: string[],
    threads: number
  ): Promise<string> {
    const requestId =
      Math.random().toString(36).substring(2) + "." + Date.now().toString(36);
    this.port.write(
      JSON.stringify({
        type: "start",
        payload: { script, args, threads, requestId },
      })
    );
    return requestId;
  }

  public async finished(pid: number, hostname: string): Promise<void> {
    this.port.write(
      JSON.stringify({ type: "finished", payload: { pid, hostname } })
    );
  }

  public async tailDaemon(): Promise<void> {
    this.port.write(JSON.stringify({ type: "tail-daemon" }));
  }
}

export function thisProcessFinished(ns: NS): void {
  const ctl = new SupervisorCtl(ns);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  ctl.finished(ns.getRunningScript()!.pid, ns.getHostname());
}
