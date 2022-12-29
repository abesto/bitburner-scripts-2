import { NS } from '@ns';

import { Identity } from 'variant/lib/util';

import { Fmt } from '/fmt';
import { Log } from '/log';

import { TimerManager } from '../TimerManager';
import { ClientPort } from './ClientPort';
import { ServerPort } from './ServerPort';

export type HandleRequestResult = "continue" | "exit";

export abstract class BaseService<Request, Response> {
  private lastYield = Date.now();
  protected readonly log: Log;
  protected readonly listenPort: ServerPort<Identity<Request>>;
  protected readonly fmt: Fmt;
  private readonly timers = new TimerManager();

  constructor(protected readonly ns: NS, log?: Log) {
    this.log = log ?? new Log(ns, this.constructor.name);
    this.listenPort = new ServerPort(
      ns,
      this.log,
      this.listenPortNumber(),
      this.parseRequest
    );
    this.fmt = new Fmt(ns);
    this.registerTimers(this.timers);
  }

  protected abstract listenPortNumber(): number;
  protected abstract parseRequest(message: unknown): Identity<Request> | null;
  protected abstract handleRequest(
    request: Identity<Request> | null
  ): Promise<HandleRequestResult> | HandleRequestResult;
  protected listenReadTimeout(): number {
    return Infinity;
  }
  protected maxTimeSlice(): number {
    return 100;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected registerTimers(timers: TimerManager): void {
    // Override to register timers at construction time
  }

  async listen(): Promise<void> {
    this.log.info("Listening", { port: this.listenPort.portNumber });
    const buffer = new Array<Identity<Request>>();
    let exit = false;
    while (!exit) {
      await this.timers.invoke();
      buffer.push(...this.listenPort.drain());
      const request =
        buffer.shift() ??
        (await this.listenPort.read({
          timeout: Math.min(
            this.listenReadTimeout(),
            this.timers.getTimeUntilNextEvent()
          ),
          throwOnTimeout: false,
        }));
      const result = await this.handleRequest(request);
      if (result === "exit") {
        exit = true;
      } else if (Date.now() - this.lastYield > this.maxTimeSlice()) {
        this.lastYield = Date.now();
        await this.ns.sleep(0);
      }
    }
    this.log.info("Exiting", { port: this.listenPort.portNumber });
  }

  respond(port: number | null, response: Response): void {
    if (port === null) {
      return;
    }
    const client = new ClientPort(this.ns, this.log, port);
    client.writeSync(response);
  }
}
