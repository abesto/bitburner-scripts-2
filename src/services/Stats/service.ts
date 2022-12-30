import { match } from 'variant';

import { BaseService, HandleRequestResult } from '../common/BaseService';
import { SERVICE_ID, StatsRequest, StatsResponse, Time, Value } from './types';

export class StatsService extends BaseService<
  typeof StatsRequest,
  StatsResponse
> {
  private readonly data: Map<string, Map<Time, Value>> = new Map();

  protected override serviceId(): typeof SERVICE_ID {
    return SERVICE_ID;
  }
  protected override RequestType(): typeof StatsRequest {
    return StatsRequest;
  }

  protected handleRequest(
    request: StatsRequest
  ): HandleRequestResult | Promise<HandleRequestResult> {
    match(request, {
      record: (request) => this.record(request),
      getRaw: (request) => this.getRaw(request),
      listSeries: (request) => this.listSeries(request),
    });
    return "continue";
  }

  private record(request: StatsRequest<"record">): void {
    const { series, event, action } = request;
    const [timestamp, value] = event;
    const timeBucket = Math.floor(timestamp / 1000);

    let s = this.data.get(series);
    if (s === undefined) {
      s = new Map();
      this.data.set(series, s);
    }
    if (action === "overwrite") {
      s.set(timeBucket, value);
    } else if (action === "add") {
      const existing = s.get(timeBucket);
      if (existing === undefined) {
        s.set(timeBucket, value);
      } else {
        s.set(timeBucket, existing + value);
      }
    } else {
      throw new Error(`unknown action: ${action}`);
    }
  }

  private getRaw(request: StatsRequest<"getRaw">): void {
    const { series, since, responsePort } = request;
    const s = this.data.get(series);

    let response = StatsResponse.getRaw("not-found");
    if (s !== undefined) {
      if (since === undefined) {
        response = StatsResponse.getRaw(Array.from(s.entries()));
      } else {
        const sinceBucket = Math.floor(since / 1000);
        response = StatsResponse.getRaw(
          Array.from(s.entries()).filter(
            ([timeBucket]) => timeBucket >= sinceBucket
          )
        );
      }
    }
    this.respond(responsePort, response);
  }

  private listSeries(request: StatsRequest<"listSeries">): void {
    const { prefix, responsePort } = request;
    const series = Array.from(this.data.keys());
    if (prefix === undefined) {
      this.respond(responsePort, StatsResponse.listSeries(series));
    } else {
      this.respond(
        responsePort,
        StatsResponse.listSeries(series.filter((s) => s.startsWith(prefix)))
      );
    }
  }
}
