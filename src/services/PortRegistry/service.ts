import { match } from 'variant';

import { freePorts, PORTS } from '/ports';

import { BaseService, HandleRequestResult } from '../common/BaseService';
import { TimerManager } from '../TimerManager';
import {
    PortRegistryRequest, PortRegistryResponse, SERVICE_ID, toPortRegistryRequest
} from './types';

export class PortRegistryService extends BaseService<
  PortRegistryRequest,
  PortRegistryResponse
> {
  // Ports taken by running processes
  private readonly reserved: Map<number, { hostname: string; pid: number }> =
    new Map();

  // Ports previously taken, and now ready for reuse
  private readonly free: number[] = [];

  // Lowest port number never taken
  private freeHigh = 1024;

  protected override listenPortNumber(): number {
    return PORTS[SERVICE_ID];
  }
  protected override parseRequest(
    message: unknown
  ): PortRegistryRequest | null {
    return toPortRegistryRequest(message);
  }
  protected override listenReadTimeout(): number {
    return 1000;
  }
  protected override registerTimers(timers: TimerManager): void {
    timers.setInterval(this.freeLeakedPorts.bind(this), 1000);
  }

  protected handleRequest(
    request: PortRegistryRequest | null
  ): HandleRequestResult {
    this.populateFreePorts();
    if (request === null) {
      return "continue";
    }
    let result: HandleRequestResult = "continue";
    match(request, {
      exit: () => {
        result = "exit";
      },

      reserve: ({ port, hostname, pid }) => {
        const existingOwner = this.reserved.get(port);
        if (existingOwner !== undefined) {
          this.log.terror("Port already reserved, killing offending process", {
            port,
            owner: `${existingOwner.hostname}:${existingOwner.pid}`,
            offender: `${hostname}:${pid}`,
          });
          this.ns.kill(pid);
        } else {
          this.log.info("Reserving port", { port, hostname, pid });
          this.reserved.set(port, { hostname, pid });
        }
      },

      release: ({ port, hostname, pid }) => {
        const owner = this.reserved.get(port);
        if (owner === undefined) {
          this.log.terror("Tried to release unreserved port", { port });
        } else if (owner.hostname !== hostname || owner.pid !== pid) {
          this.log.terror("Tried to release port reserved by another process", {
            port,
            owner: `${owner.hostname}:${owner.pid}`,
            caller: `${hostname}:${pid}`,
          });
        } else {
          this.log.info("Releasing port", { port, hostname, pid });
          this.reserved.delete(port);
          this.free.push(port);
        }
      },

      status: ({ responsePort }) => {
        const response = PortRegistryResponse.status({
          reserved: Array.from(this.reserved.entries()).map(
            ([port, { hostname, pid }]) => ({
              port,
              hostname,
              pid,
            })
          ),
          free: this.free,
          freeHigh: this.freeHigh,
        });
        this.log.debug("Sending status response", { response });
        this.respond(responsePort, response);
      },
    });
    return result;
  }

  private populateFreePorts(): void {
    const outputPort = freePorts(this.ns);
    while (!outputPort.full()) {
      const reused = this.free.splice(1000, 1)[0];
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
}
