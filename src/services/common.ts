import { NetscriptPort, NS } from '@ns';

import { Log } from '/log';
import { Handler, match, VariantsOfUnion } from 'variant';
import { PortRegistryClient } from './PortRegistry/client';

export class ClientPort<T> {
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

  async write(data: T): Promise<void> {
    if (this.port === null) {
      return;
    }
    let old = this.port.write(JSON.stringify(data));
    await this.ns.sleep(0);
    // TODO make jitter magnitude and backoffBase configurable
    const jitter = () => Math.floor(Math.random() * 100);
    const backoffBase = 100;
    let backoffExp = 1;
    while (old !== null) {
      await this.ns.sleep(backoffBase ** backoffExp + jitter());
      backoffExp += 1;
      old = this.port.write(old);
      if (backoffExp > 10) {
        this.log.terror("Failed to write to port", {
          port: this.portNumber,
          retries: backoffExp,
        });
      }
    }
    await this.ns.sleep(0);
  }
}

export class ServerPort<T> {
  private readonly port: NetscriptPort;

  constructor(
    private readonly ns: NS,
    private readonly log: Log,
    readonly portNumber: number,
    private readonly parse: (message: unknown) => T | null
  ) {
    this.port = ns.getPortHandle(portNumber);
  }

  async read(
    timeout: number | undefined | null = undefined
  ): Promise<T | null> {
    if (timeout === undefined) {
      timeout = 5000;
    }
    if (this.port.empty()) {
      const promise =
        timeout === null
          ? this.port.nextWrite()
          : Promise.any([this.port.nextWrite(), this.ns.asleep(timeout)]);
      if (await promise) {
        throw new Error(`Timeout reading from port ${this.portNumber}`);
      }
    }
    const data = this.port.read();
    await this.ns.sleep(0);
    try {
      const json = JSON.parse(data.toString());
      const parsed = this.parse(json);
      if (parsed === null) {
        this.log.terror("Failed to parse message", { data });
      }
      return parsed;
    } catch (e) {
      this.log.terror("Failed to parse message", { data, e });
      return null;
    }
  }

  empty(): boolean {
    return this.port.empty();
  }

  nextWrite(): Promise<void> {
    return this.port.nextWrite();
  }

  clear(): void {
    this.port.clear();
  }
}

export abstract class BaseNoResponseClient<Request extends { type: string }> {
  protected readonly requestPort: ClientPort<Request>;

  protected constructor(
    protected readonly ns: NS,
    protected readonly log: Log
  ) {
    this.requestPort = new ClientPort(ns, log, this.requestPortNumber());
  }

  protected abstract requestPortNumber(): number;

  protected async send(request: Request): Promise<void> {
    await this.requestPort.write(request);
  }
}

export abstract class BaseClient<
  Request extends { type: string },
  Response extends { type: string }
> extends BaseNoResponseClient<Request> {
  protected readonly responsePort: ServerPort<Response>;
  protected readonly portRegistryClient: PortRegistryClient;

  constructor(
    ns: NS,
    log: Log,
    responsePortNumber: number,
    portRegistryClient?: PortRegistryClient
  ) {
    super(ns, log);
    this.responsePort = new ServerPort(
      ns,
      log,
      responsePortNumber,
      this.parseResponse
    );
    this.portRegistryClient =
      portRegistryClient ?? new PortRegistryClient(ns, log);
  }

  protected abstract parseResponse(message: unknown): Response | null;

  async release(): Promise<void> {
    await this.portRegistryClient.releasePort(this.responsePort.portNumber);
  }

  handleResponse<
    Ret,
    M extends Partial<Handler<VariantsOfUnion<Response, "type">, Ret>>
  >(result: Response | null, matcher: M): Ret {
    if (result === null) {
      throw new Error("Invalid response");
    }
    return match(result, matcher, () => {
      throw new Error(`Invalid response: ${JSON.stringify(result)}`);
    });
  }

  async sendReceive<
    Ret,
    M extends Partial<Handler<VariantsOfUnion<Response, "type">, Ret>>
  >(
    request: Request,
    matcher: M,
    options: { readTimeout?: number | null } = {}
  ): Promise<Ret> {
    await this.send(request);
    const response = await this.responsePort.read(options.readTimeout);
    return this.handleResponse(response, matcher);
  }

  protected rp(): { responsePort: number } {
    return { responsePort: this.responsePort.portNumber };
  }
}

export async function reservingNewPort<
  Request extends { type: string },
  Response extends { type: string },
  C extends BaseClient<Request, Response>
>(
  cls: {
    new (
      ns: NS,
      log: Log,
      responsePortNumber: number,
      portRegistryClient?: PortRegistryClient
    ): C;
  },
  ns: NS,
  log: Log
): Promise<C> {
  const portRegistryClient = new PortRegistryClient(ns, log);
  const responsePortNumber = await portRegistryClient.reservePort();
  return new cls(ns, log, responsePortNumber, portRegistryClient);
}

export async function withClient<
  Request extends { type: string },
  Response extends { type: string },
  C extends BaseClient<Request, Response>,
  R
>(
  cls: {
    new (
      ns: NS,
      log: Log,
      responsePortNumber: number,
      portRegistryClient?: PortRegistryClient
    ): C;
  },
  ns: NS,
  log: Log,
  callback: (client: C) => Promise<R>
): Promise<R> {
  const client = await reservingNewPort(cls, ns, log);
  let retval;
  try {
    retval = await callback(client);
  } finally {
    await client.release();
  }
  return retval;
}
