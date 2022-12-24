import { NetscriptPort, NS } from '@ns';

import { Log } from '/log';
import { freePorts, portRegistry, PORTS } from '/ports';
import { matchI } from 'ts-adt';
import { PortRegistryRequest, SERVICE_ID, statusResponse, toPortRegistryRequest } from './types';

export class PortRegistryService {
  private readonly ns: NS;
  private readonly log: Log;

  // Ports taken by running processes
  private readonly reserved: Map<number, { hostname: string; pid: number }> =
    new Map();

  // Ports pushed to the free ports ... port, waiting for someone to take them
  //private readonly pending: number

  // Ports previously taken, and now ready for reuse
  private readonly free: number[] = [];

  // Lowest port number never taken
  private freeHigh = 1024;

  constructor(ns: NS) {
    this.ns = ns;
    this.log = new Log(ns, "PortRegistry");
  }

  private populateFreePorts(): void {
    const outputPort = freePorts(this.ns);
    while (!outputPort.full()) {
      const reused = this.free.shift();
      if (reused === undefined) {
        this.log.info("Allocating port", { port: this.freeHigh });
        this.ns.clearPort(this.freeHigh - 1);
        outputPort.write(this.freeHigh++);
      } else {
        this.log.info("Reusing port", { port: reused });
        this.ns.clearPort(reused);
        outputPort.write(reused);
      }
    }
  }

  private freeLeakedPorts(): void {
    for (const [port, { hostname, pid }] of this.reserved) {
      if (this.ns.ps(hostname).find((p) => p.pid === pid) === undefined) {
        this.log.warn("Releasing leaked port", { port, hostname, pid });
        this.ns.clearPort(port);
        this.free.push(port);
        this.reserved.delete(port);
      }
    }
  }

  private readRequest(port: NetscriptPort): PortRegistryRequest | null {
    const rawMessage = port.read().toString();
    this.log.debug("Received message", { rawMessage });
    try {
      const json = JSON.parse(rawMessage);
      const parsed = toPortRegistryRequest(JSON.parse(rawMessage));
      if (parsed === null) {
        this.log.terror("Failed to parse message", { json });
      }
      return parsed;
    } catch (e) {
      this.log.terror("Failed to parse message as JSON", { rawMessage });
      return null;
    }
  }

  public async listen(): Promise<void> {
    const listenPort = portRegistry(this.ns);
    this.log.info("Listening", { port: PORTS[SERVICE_ID] });

    let exit = false;
    while (!exit) {
      if (listenPort.empty()) {
        this.freeLeakedPorts();
        this.populateFreePorts();
        await Promise.any([this.ns.asleep(5000), listenPort.nextWrite()]);
        continue;
      }

      const message = this.readRequest(listenPort);
      if (message === null) {
        continue;
      }

      matchI(message)({
        exit: () => {
          this.log.info("Exiting");
          exit = true;
        },

        reserve: ({ port, hostname, pid }) => {
          const existingOwner = this.reserved.get(port);
          if (existingOwner !== undefined) {
            this.log.terror(
              "Port already reserved, killing offending process",
              {
                port,
                owner: `${existingOwner.hostname}:${existingOwner.pid}`,
                offender: `${hostname}:${pid}`,
              }
            );
            this.ns.kill(pid);
          } else {
            this.log.info("Reserving port", { port, hostname, pid });
            this.reserved.set(port, { hostname, pid });
          }
        },

        release: ({ port, hostname, pid }) => {
          const owner = this.reserved.get(port);
          if (owner === undefined) {
            this.log.terror("Tried to release unseserved port", { port });
          } else if (owner.hostname !== hostname || owner.pid !== pid) {
            this.log.terror(
              "Tried to release port reserved by another process",
              {
                port,
                owner: `${owner.hostname}:${owner.pid}`,
                caller: `${hostname}:${pid}`,
              }
            );
          } else {
            this.log.info("Releasing port", { port, hostname, pid });
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
          this.log.debug("Sending status response", { response });
          this.ns.writePort(responsePort, JSON.stringify(response));
        },
      });
    }

    this.log.info("`listen` finished");
  }
}
