import { NS, NetscriptPort } from "@ns";
import { matchI } from "ts-adt";

import { freePorts, portRegistry } from "/ports";
import {
  PortRegistryRequest,
  statusResponse,
  toPortRegistryRequest,
} from "./types";

export class PortRegistryService {
  private readonly ns: NS;

  // Ports taken by running processes
  private readonly reserved: Map<number, { hostname: string; pid: number }> =
    new Map();

  // Ports previously taken, and now ready for reuse
  private readonly free: number[] = [];

  // Lowest port number never taken
  private freeHigh = 1024;

  constructor(ns: NS) {
    this.ns = ns;
  }

  private populateFreePorts(): void {
    const outputPort = freePorts(this.ns);
    while (!outputPort.full()) {
      const reused = this.free.shift();
      if (reused === undefined) {
        this.ns.print(`Allocating port ${this.freeHigh}`);
        outputPort.write(this.freeHigh++);
      } else {
        this.ns.print(`Reusing port ${reused}`);
        outputPort.write(reused);
      }
    }
  }

  private freeLeakedPorts(): void {
    for (const [port, { hostname, pid }] of this.reserved) {
      if (this.ns.ps(hostname).find((p) => p.pid === pid) === undefined) {
        this.ns.print(`Releasing leaked port ${port} for ${hostname}:${pid}`);
        this.free.push(port);
        this.reserved.delete(port);
      }
    }
  }

  private readRequest(port: NetscriptPort): PortRegistryRequest | null {
    const rawMessage = port.read().toString();
    this.ns.print(`Received message: ${rawMessage}`);
    try {
      const parsed = toPortRegistryRequest(JSON.parse(rawMessage));
      if (parsed === null) {
        this.ns.tprint(
          `ERROR Failed to parse message as PortRegistryRequest: ${rawMessage}`
        );
      }
      return parsed;
    } catch (e) {
      this.ns.tprint(`ERROR Failed to parse message as JSON: ${rawMessage}`);
      return null;
    }
  }

  public async listen(): Promise<void> {
    const listenPort = portRegistry(this.ns);
    this.ns.print("PortRegistryService listening");

    let exit = false;
    while (!exit) {
      if (listenPort.empty()) {
        this.freeLeakedPorts();
        this.populateFreePorts();
        await listenPort.nextWrite();
        continue;
      }

      const message = this.readRequest(listenPort);
      if (message === null) {
        continue;
      }

      matchI(message)({
        exit: () => {
          this.ns.print("PortRegistryService exiting");
          exit = true;
        },

        reserve: ({ port, hostname, pid }) => {
          const existingOwner = this.reserved.get(port);
          if (existingOwner !== undefined) {
            this.ns.tprint(
              `ERROR Tried to reserve port ${port} for ${hostname}:${pid} but it is already reserved by ${existingOwner.hostname}:${existingOwner.pid}. Killing offending process.`
            );
            this.ns.kill(pid);
          } else {
            this.ns.print(`Reserving port ${port} for ${hostname}:${pid}`);
            this.reserved.set(port, { hostname, pid });
          }
        },

        release: ({ port, hostname, pid }) => {
          const owner = this.reserved.get(port);
          if (owner === undefined) {
            this.ns.tprint(
              `ERROR Tried to release port ${port} but it was not reserved`
            );
          } else if (owner.hostname !== hostname || owner.pid !== pid) {
            this.ns.tprint(
              `ERROR Release mismatch: ${port} was reserved by ${owner.hostname}:${owner.pid}, not ${hostname}:${pid}`
            );
          } else {
            this.ns.print(
              `Releasing port ${port} from ${owner.hostname}:${owner.pid}`
            );
            this.reserved.delete(port);
            this.free.push(port);
          }
        },

        status: ({ responsePort }) => {
          const response = statusResponse(
            Array.from(this.reserved.entries()).map(
              ([port, { hostname, pid }]) => ({
                port,
                hostname,
                pid,
              })
            ),
            this.free,
            this.freeHigh
          );
          this.ns.print(`Sending status response: ${JSON.stringify(response)}`);
          this.ns.writePort(responsePort, JSON.stringify(response));
        },
      });
    }

    this.ns.print("PortRegistryService listen finished");
  }
}
