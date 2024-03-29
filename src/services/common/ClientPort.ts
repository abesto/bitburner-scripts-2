import { NetscriptPort, NS } from "@ns";

import { VariantModule } from "variant";
import { SumType } from "variant/lib/variant";

import { Log } from "/log";

export interface ClientWriteOptions {
  backoff?: boolean;
}

export class ClientPort<T extends VariantModule> {
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

  writeSync(data: SumType<T>): SumType<T> | null {
    if (this.port === null) {
      return null;
    }
    const old = this.port.write(data);
    if (old !== null) {
      return old;
    }
    return null;
  }

  async write(data: T, options?: ClientWriteOptions): Promise<void> {
    if (this.port === null) {
      return;
    }
    const backoff = options?.backoff ?? true;
    let old = this.port.write(data);
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
    const jitter = () => Math.floor(Math.random() * 10);
    const backoffBase = 10;
    let backoffExp = 1;
    while (old !== null) {
      await this.ns.sleep(backoffBase ** backoffExp + jitter());
      backoffExp += 1;
      old = this.port.write(old);
      if (backoffExp > 3) {
        this.log.terror("Failed to write to port", {
          port: this.portNumber,
          retries: backoffExp,
        });
      }
    }
    //this.log.tdebug("Wrote to port", { port: this.portNumber, data });
  }
}
