import { NetscriptPort, NS } from '@ns';

import { Log } from '/log';
import { PORTS } from '/ports';
import { getProcessInfo } from '/procinfo';

import { BaseNoResponseClient } from '../common/BaseNoResponseClient';
import { PortRegistryRequest as Request, SERVICE_ID } from './types';

export class PortRegistryClient extends BaseNoResponseClient<typeof Request> {
  private readonly freePortsPort: NetscriptPort;

  requestPortNumber(): number {
    return PORTS[SERVICE_ID];
  }

  constructor(ns: NS, log: Log) {
    super(ns, log);
    this.freePortsPort = ns.getPortHandle(PORTS.FreePorts);
  }

  public async reservePort(): Promise<number> {
    const port = this.freePortsPort.read();
    if (port === "NULL PORT DATA") {
      throw new Error("Failed to parse port");
    }
    if (typeof port !== "number") {
      throw new Error(`Failed to parse port: ${port}`);
    }

    this.ns.clearPort(port);
    await this.send(
      Request.reserve({
        port,
        hostname: this.ns.getHostname(),
        pid: this.ns.pid,
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
