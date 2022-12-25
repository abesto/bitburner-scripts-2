import { PORTS } from '/ports';

import { BaseClient } from '../common/BaseClient';
import { id } from '../common/Result';
import {
    PortRegistryRequest as Request, PortRegistryResponse as Response, SERVICE_ID,
    toPortRegistryResponse
} from './types';

export class PortRegistryStatusClient extends BaseClient<Request, Response> {
  requestPortNumber(): number {
    return PORTS[SERVICE_ID];
  }

  parseResponse(response: unknown): Response | null {
    return toPortRegistryResponse(response);
  }

  async status(): Promise<Response<"status">> {
    return this.sendReceive(Request.status(this.rp()), {
      status: id,
    });
  }
}
