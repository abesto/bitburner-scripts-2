import { NetscriptPort, NS } from '@ns';

import { Log } from '/log';

export class ClientPort<T> {
  private readonly port: NetscriptPort | null;

  constructor(
    private readonly ns: NS,
    private readonly log: Log,
    private readonly portNumber: number | null
  ) {
    if (portNumber === null) {
      this.port = null;
    } else {
      this.port = ns.getPortHandle(portNumber);
    }
  }

  async write(data: T): Promise<void> {
    if (this.port === null) {
      return;
    }
    let old = this.port.write(JSON.stringify(data));
    await this.ns.sleep(0);
    // TODO make jitter magnitude and backoffBase configurable
    const jitter = () => Math.floor(Math.random() * 100);
    const backoffBase = 100;
    let backoffExp = 1;
    while (old !== null) {
      await this.ns.sleep(backoffBase ** backoffExp + jitter());
      backoffExp += 1;
      old = this.port.write(old);
      if (backoffExp > 10) {
        this.log.terror("Failed to write to port", {
          port: this.portNumber,
          retries: backoffExp,
        });
      }
    }
    await this.ns.sleep(0);
  }
}

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

  async read(timeout: number | null = 5000): Promise<T | null> {
    if (this.port.empty()) {
      const promise =
        timeout === null
          ? this.port.nextWrite()
          : Promise.any([this.port.nextWrite(), this.ns.asleep(timeout)]);
      if (await promise) {
        throw new Error(`Timeout reading from port ${this.portNumber}`);
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
}
