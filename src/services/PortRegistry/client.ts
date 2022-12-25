import { NS } from '@ns';

import { Log } from '/log';
import { PORTS } from '/ports';
import { getProcessInfo } from '/procinfo';
import { refinement } from 'ts-adt';
import { ClientPort, ServerPort } from '../common';
import {
    PortRegistryRequest, PortRegistryResponse, PortRegistryResponse$Status, releaseRequest,
    reserveRequest, SERVICE_ID as PORT_REGISTRY, statusRequest, toPortRegistryResponse
} from './types';

export class PortRegistryClient {
  private readonly portRegistryPort: ClientPort<PortRegistryRequest>;
  private readonly freePortsPort: ServerPort<number>;

  constructor(private readonly ns: NS, private readonly log: Log) {
    this.portRegistryPort = new ClientPort(ns, log, PORTS[PORT_REGISTRY]);
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
    await this.portRegistryPort.write(
      reserveRequest(port, this.ns.getHostname(), getProcessInfo(this.ns).pid)
    );
    //this.ns.print(`[PortRegistryClient] Reserved port ${port}`);
    return port;
  }

  public async releasePort(port: number): Promise<void> {
    const data = releaseRequest(
      port,
      this.ns.getHostname(),
      getProcessInfo(this.ns).pid
    );
    await this.portRegistryPort.write(data);
    //this.ns.print(`[PortRegistryClient] Released port ${port}: ${data}`);
  }

  public async status(): Promise<PortRegistryResponse$Status> {
    const responsePortNumber = await this.reservePort();
    await this.portRegistryPort.write(statusRequest(responsePortNumber));

    const responsePort = new ServerPort<PortRegistryResponse>(
      this.ns,
      this.log,
      responsePortNumber,
      toPortRegistryResponse
    );
    const response = await responsePort.read();
    await this.releasePort(responsePortNumber);
    // TODO this part should be factored out, but the typing is tricky.
    if (response === null) {
      throw new Error("Invalid response");
    }
    if (refinement("status")(response)) {
      return response;
    } else {
      throw new Error(`Invalid response: ${JSON.stringify(response)}`);
    }
  }
}
