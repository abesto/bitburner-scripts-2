import { NS } from '@ns';

import { Log } from '/log';

import { ClientPort, ClientWriteOptions } from '../common/ClientPort';

export abstract class BaseNoResponseClient<Request extends { type: string }> {
  protected readonly requestPort: ClientPort<Request>;

  constructor(protected readonly ns: NS, protected readonly log: Log) {
    this.requestPort = new ClientPort(ns, log, this.requestPortNumber());
  }

  protected abstract requestPortNumber(): number;

  protected async send(
    request: Request,
    options?: ClientWriteOptions
  ): Promise<void> {
    await this.requestPort.write(request, options);
  }
}
