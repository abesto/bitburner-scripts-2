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
    if (this.port.empty()) {
      const promise =
        timeout === 0
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
    await this.ns.sleep(0);
    try {
      const json = JSON.parse(data.toString());
      const parsed = this.parse(json);
      if (parsed === null) {
        this.log.terror("Failed to parse message", { data });
      }
      return parsed;
    } catch (e) {
      this.log.terror("Failed to parse message", { data, e });
      return null;
    }
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
