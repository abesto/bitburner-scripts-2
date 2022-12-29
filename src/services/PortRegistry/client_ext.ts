import { BaseClient } from '../common/BaseClient';
import { id } from '../common/Result';
import {
    PortRegistryRequest as Request, PortRegistryResponse as Response, SERVICE_ID
} from './types';

export class PortRegistryStatusClient extends BaseClient<
  typeof Request,
  typeof Response
> {
  protected override serviceId(): typeof SERVICE_ID {
    return SERVICE_ID;
  }
  protected override ResponseMessageType(): typeof Response {
    return Response;
  }
  async status(): Promise<Response<"status">> {
    return this.sendReceive(Request.status(this.rp()), {
      status: id,
    });
  }
}
