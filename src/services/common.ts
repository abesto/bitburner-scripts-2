import { NS, NetscriptPort } from "@ns";

export class ClientPort<T> {
  private readonly port: NetscriptPort | null;

  constructor(
    private readonly ns: NS,
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
        this.ns.tprint(
          `ERROR Backoff number ${backoffExp} to write to port ${this.portNumber}`
        );
      }
    }
    await this.ns.sleep(0);
  }
}

export class ServerPort<T> {
  private readonly port: NetscriptPort;

  constructor(
    private readonly ns: NS,
    private readonly portNumber: number,
    private readonly parse: (message: unknown) => T | null
  ) {
    this.port = ns.getPortHandle(portNumber);
  }

  async read(): Promise<T | null> {
    if (this.port.empty()) {
      if (await Promise.any([this.port.nextWrite(), this.ns.asleep(5000)])) {
        throw new Error(`Timeout reading from port ${this.portNumber}`);
      }
    }
    const data = this.port.read();
    await this.ns.sleep(0);
    try {
      const json = JSON.parse(data.toString());
      const parsed = this.parse(json);
      if (parsed === null) {
        this.ns.tprint(`ERROR Wrong message type: ${data}`);
      }
      return parsed;
    } catch (e) {
      this.ns.tprint(`ERROR Failed to parse message: ${data}`);
      return null;
    }
  }
}
