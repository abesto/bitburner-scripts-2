import { NetscriptPort, NS } from '@ns';

import { Log } from '/log';

export class ServerPort<T> {
  private readonly port: NetscriptPort;

  constructor(
    private readonly ns: NS,
    private readonly log: Log,
    readonly portNumber: number,
    private readonly parse: (message: unknown) => T | null
  ) {
    this.port = ns.getPortHandle(portNumber);
  }

  async read(options?: {
    timeout?: number;
    throwOnTimeout?: boolean;
  }): Promise<T | null> {
    const timeout = options?.timeout ?? 5000;
    const throwOnTimeout = options?.throwOnTimeout ?? true;
    if (this.port.empty() && timeout > 0) {
      const promise =
        timeout === Infinity
          ? this.port.nextWrite()
          : Promise.any([this.port.nextWrite(), this.ns.asleep(timeout)]);
      if (await promise) {
        if (throwOnTimeout) {
          throw new Error(`Timeout reading from port ${this.portNumber}`);
        } else {
          return null;
        }
      }
    }
    const data = this.port.read();
    if (data === "NULL PORT DATA") {
      return null;
    }
    try {
      const json = JSON.parse(data.toString());
      const parsed = this.parse(json);
      if (parsed === null) {
        this.log.terror("Failed to parse message", { data });
      }
      //this.log.tdebug("Read from port", { port: this.portNumber, data });
      return parsed;
    } catch (e) {
      this.log.terror("Failed to parse message", { data, e });
      return null;
    }
  }

  drain(): T[] {
    const messages: T[] = [];
    while (!this.port.empty()) {
      const data = this.port.read();
      if (data === "NULL PORT DATA") {
        continue;
      }
      try {
        const json = JSON.parse(data.toString());
        const parsed = this.parse(json);
        if (parsed === null) {
          this.log.terror("Failed to parse message", { data });
        } else {
          messages.push(parsed);
        }
      } catch (e) {
        this.log.terror("Failed to parse message", { data, e });
      }
    }
    return messages;
  }

  empty(): boolean {
    return this.port.empty();
  }

  nextWrite(): Promise<void> {
    return this.port.nextWrite();
  }

  clear(): void {
    this.port.clear();
  }
}
