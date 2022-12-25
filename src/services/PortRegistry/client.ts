import { NS } from '@ns';

import { Log } from '/log';
import { PORTS } from '/ports';
import { getProcessInfo } from '/procinfo';

import { BaseNoResponseClient } from '../common/BaseNoResponseClient';
import { ServerPort } from '../common/ServerPort';
import { PortRegistryRequest as Request, SERVICE_ID } from './types';

export class PortRegistryClient extends BaseNoResponseClient<Request> {
  private readonly freePortsPort: ServerPort<number>;

  requestPortNumber(): number {
    return PORTS[SERVICE_ID];
  }

  constructor(ns: NS, log: Log) {
    super(ns, log);
    this.freePortsPort = new ServerPort(ns, log, PORTS.FreePorts, (data) => {
      if (typeof data === "number") {
        return data;
      } else {
        return null;
      }
    });
  }

  public async reservePort(): Promise<number> {
    const port = await this.freePortsPort.read();
    if (port === null) {
      throw new Error("Failed to parse port");
    }

    this.ns.clearPort(port);
    await this.send(
      Request.reserve({
        port,
        hostname: this.ns.getHostname(),
        pid: getProcessInfo(this.ns).pid,
      })
    );
    return port;
  }

  public async releasePort(port: number): Promise<void> {
    await this.send(
      Request.release({
        port,
        hostname: this.ns.getHostname(),
        pid: getProcessInfo(this.ns).pid,
      })
    );
  }
}
