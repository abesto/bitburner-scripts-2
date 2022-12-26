import { NetscriptPort, NS } from '@ns';

import { Log } from '/log';

export interface ClientWriteOptions {
  backoff?: boolean;
}

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

  async write(data: T, options?: ClientWriteOptions): Promise<void> {
    if (this.port === null) {
      return;
    }
    const backoff = options?.backoff ?? true;
    let old = this.port.write(JSON.stringify(data));
    await this.ns.sleep(0);
    if (!backoff) {
      if (old !== null) {
        /*
        this.log.tdebug("Port full", {
          port: this.portNumber,
          dropped: old,
        });
        */
      }
      return;
    }
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
