import { NS } from '@ns';

import { VariantModule } from 'variant';
import { SumType } from 'variant/lib/variant';

import { Log } from '/log';

import { ClientPort, ClientWriteOptions } from '../common/ClientPort';

export abstract class BaseNoResponseClient<Request extends VariantModule> {
  protected readonly requestPort: ClientPort<Request>;

  constructor(protected readonly ns: NS, protected readonly log: Log) {
    this.requestPort = new ClientPort(ns, log, this.requestPortNumber());
  }

  protected abstract requestPortNumber(): number;

  protected async send(
    request: SumType<Request>,
    options?: ClientWriteOptions
  ): Promise<void> {
    await this.requestPort.write(request, options);
  }

  protected sendSync(request: SumType<Request>): SumType<Request> | null {
    return this.requestPort.writeSync(request);
  }
}
