import { NS, NetscriptPort } from "@ns";
import { matchPI } from "ts-adt";
import {
  PortRegistryResponse$Status,
  releaseRequest,
  reserveRequest,
  statusRequest,
  toPortRegistryResponse,
} from "./types";
import { freePorts, portRegistry } from "/ports";

export class PortRegistryClient {
  private readonly ns: NS;
  private readonly servicePort: NetscriptPort;
  private readonly freePortsPort: NetscriptPort;

  constructor(ns: NS) {
    this.ns = ns;
    this.servicePort = portRegistry(ns);
    this.freePortsPort = freePorts(ns);
  }

  public async reservePort(): Promise<number> {
    const portStr = this.freePortsPort.read().toString();

    if (portStr === "NULL PORT DATA") {
      throw new Error(
        "Failed to get free port, PortRegistryService not running?"
      );
    }

    const port = parseInt(portStr);
    if (isNaN(port)) {
      throw new Error(`Failed to parse port: ${portStr}`);
    }

    this.servicePort.write(
      JSON.stringify(
        reserveRequest(
          port,
          this.ns.getHostname(),
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          this.ns.getRunningScript()!.pid
        )
      )
    );
    this.ns.print(`[PortRegistryClient] Reserved port ${port}`);
    await this.ns.sleep(0);
    return port;
  }

  public async releasePort(port: number): Promise<void> {
    const data = JSON.stringify(
      releaseRequest(
        port,
        this.ns.getHostname(),
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        this.ns.getRunningScript()!.pid
      )
    );
    this.servicePort.write(data);
    this.ns.print(`[PortRegistryClient] Released port ${port}: ${data}`);
    await this.ns.sleep(0);
  }

  public async status(): Promise<PortRegistryResponse$Status> {
    const responsePortNumber = await this.reservePort();

    this.servicePort.write(JSON.stringify(statusRequest(responsePortNumber)));
    await this.ns.sleep(0);

    const responsePort = this.ns.getPortHandle(responsePortNumber);
    if (responsePort.empty()) {
      await responsePort.nextWrite();
    }
    const rawResponse = responsePort.read().toString();
    const response = toPortRegistryResponse(JSON.parse(rawResponse));
    if (response === null) {
      throw new Error(`Failed to parse response: ${rawResponse}`);
    }

    const status = matchPI(response)(
      {
        status: (status) => status,
      },
      (rest) => {
        throw new Error(`Unexpected response: ${JSON.stringify(rest)}`);
      }
    );

    await this.releasePort(responsePortNumber);
    return status;
  }
}
