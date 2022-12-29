import { NS } from '@ns';

import { Handler, match, VariantsOfUnion } from 'variant';

import { Log } from '/log';

import { PortRegistryClient } from '../PortRegistry/client';
import { BaseNoResponseClient } from './BaseNoResponseClient';
import { ReadOptions, ServerPort } from './ServerPort';

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

  handleResponseOrNull<
    Ret,
    M extends Partial<Handler<VariantsOfUnion<Response, "type">, Ret>>
  >(result: Response | null, matcher: M): Ret | null {
    if (result === null) {
      return null;
    }
    return match(result, matcher, () => {
      throw new Error(`Invalid response: ${JSON.stringify(result)}`);
    });
  }

  async receive<
    Ret,
    M extends Partial<Handler<VariantsOfUnion<Response, "type">, Ret>>
  >(matcher: M, options?: ReadOptions): Promise<Ret> {
    const response = await this.responsePort.read(options);
    return this.handleResponse(response, matcher);
  }

  async receiveOrNull<
    Ret,
    M extends Partial<Handler<VariantsOfUnion<Response, "type">, Ret>>
  >(matcher: M, options?: ReadOptions): Promise<Ret | null> {
    const response = await this.responsePort.read(options);
    return this.handleResponseOrNull(response, matcher);
  }

  async sendReceive<
    Ret,
    M extends Partial<Handler<VariantsOfUnion<Response, "type">, Ret>>
  >(request: Request, matcher: M, readOptions?: ReadOptions): Promise<Ret> {
    await this.send(request);
    return await this.receive(matcher, readOptions);
  }

  protected rp(): { responsePort: number } {
    return { responsePort: this.responsePort.portNumber };
  }
}
