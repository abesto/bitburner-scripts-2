import { NS } from '@ns';

import { Log } from '/log';
import { PORTS } from '/ports';
import { getProcessInfo } from '/procinfo';
import { BaseClient, BaseNoResponseClient, ServerPort, withClient } from '../common';
import {
    PortRegistryRequest as Request, PortRegistryResponse as Response, SERVICE_ID,
    toPortRegistryResponse
} from './types';

export class PortRegistryClient extends BaseNoResponseClient<Request> {
  private readonly freePortsPort: ServerPort<number>;
  requestPortNumber = () => PORTS[SERVICE_ID];

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

  public status(): Promise<Response<"status">> {
    return withClient(
      _PortRegistryStatusClient,
      this.ns,
      this.log,
      async (client) => {
        return await client.status();
      }
    );
  }
}

class _PortRegistryStatusClient extends BaseClient<Request, Response> {
  requestPortNumber = () => PORTS[SERVICE_ID];
  parseResponse = toPortRegistryResponse;

  async status(): Promise<Response<"status">> {
    return this.sendReceive(Request.status(this.rp()), {
      status: (x) => x,
    });
  }
}
