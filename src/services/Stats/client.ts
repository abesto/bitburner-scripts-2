import { PORTS } from "/ports";

import { BaseClient } from "../common/BaseClient";
import { BaseNoResponseClient } from "../common/BaseNoResponseClient";
import {
  GetAgg,
  SERVICE_ID,
  StatsRequest,
  StatsResponse,
  Time,
  TSEvent,
  Value,
} from "./types";

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

  record(series: string, value: Value): void {
    this.sendSync(StatsRequest.record({ series, event: [Date.now(), value] }));
  }

  listSeries(prefix?: string): Promise<string[]> {
    return this.sendReceive(StatsRequest.listSeries({ prefix, ...this.rp() }), {
      listSeries: (list) => list.payload,
    });
  }

  get(
    series: string,
    agg: GetAgg,
    since?: Time
  ): Promise<TSEvent[] | "not-found"> {
    return this.sendReceive(
      StatsRequest.get({ series, agg, since, ...this.rp() }),
      {
        get: (resp) => resp.payload,
      }
    );
  }
}

export class NoResponseStatsClient extends BaseNoResponseClient<
  typeof StatsRequest
> {
  protected override requestPortNumber(): number {
    return PORTS[SERVICE_ID];
  }

  record(series: string, value: Value): void {
    this.sendSync(StatsRequest.record({ series, event: [Date.now(), value] }));
  }
}
