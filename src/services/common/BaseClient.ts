import { NS } from '@ns';

import { Handler, match, VariantsOfUnion } from 'variant';

import { Log } from '/log';

import { PortRegistryClient } from '../PortRegistry/client';
import { BaseNoResponseClient } from './BaseNoResponseClient';
import { ServerPort } from './ServerPort';

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
    options: { readTimeout?: number } = {}
  ): Promise<Ret> {
    await this.send(request);
    const response = await this.responsePort.read({
      timeout: options.readTimeout,
    });
    return this.handleResponse(response, matcher);
  }

  protected rp(): { responsePort: number } {
    return { responsePort: this.responsePort.portNumber };
  }
}
