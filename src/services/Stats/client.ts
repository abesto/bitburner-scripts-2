import { BaseClient } from '../common/BaseClient';
import { Event, SERVICE_ID, StatsRequest, StatsResponse, Value } from './types';

export class StatsClient extends BaseClient<
  typeof StatsRequest,
  typeof StatsResponse
> {
  protected override serviceId(): typeof SERVICE_ID {
    return SERVICE_ID;
  }
  protected ResponseType(): typeof StatsResponse {
    return StatsResponse;
  }

  record(
    series: string,
    value: Value,
    action: "overwrite" | "add" = "overwrite"
  ): Promise<void> {
    return this.send(
      StatsRequest.record({ series, event: [Date.now(), value], action })
    );
  }

  listSeries(prefix?: string): Promise<string[]> {
    return this.sendReceive(StatsRequest.listSeries({ prefix, ...this.rp() }), {
      listSeries: (list) => list.payload,
    });
  }

  getRaw(series: string, since?: number): Promise<Event[] | "not-found"> {
    return this.sendReceive(
      StatsRequest.getRaw({ series, since, ...this.rp() }),
      {
        getRaw: (list) => list.payload,
      }
    );
  }
}
