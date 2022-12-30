import { match } from 'variant';

import { BaseService, HandleRequestResult } from '../common/BaseService';
import { TimerManager } from '../TimerManager';
import { rebucket } from './agg';
import {
    AGG_MAP, eventValue, SERVICE_ID, StatsRequest, StatsResponse, Time, TSEvent
} from './types';

// TODO degrade resolution over time
const RETENTION_MS = 10 * 60 * 1000;

export class StatsService extends BaseService<
  typeof StatsRequest,
  StatsResponse
> {
  private readonly data: Map<string, TSEvent[]> = new Map();

  protected override serviceId(): typeof SERVICE_ID {
    return SERVICE_ID;
  }
  protected override RequestType(): typeof StatsRequest {
    return StatsRequest;
  }
  protected override registerTimers(timers: TimerManager): void {
    timers.setInterval(this.maintain.bind(this), 1000);
  }

  protected maintain() {
    const now = Date.now();
    for (const [, events] of this.data) {
      const index = this.indexOfTime(events, now - RETENTION_MS);
      if (index > 0) {
        events.splice(0, index);
      }
    }
  }

  protected handleRequest(
    request: StatsRequest
  ): HandleRequestResult | Promise<HandleRequestResult> {
    match(request, {
      record: (request) => this.record(request),
      get: (request) => this.get(request),
      listSeries: (request) => this.listSeries(request),
    });
    return "continue";
  }

  private record(request: StatsRequest<"record">): void {
    const { series, event } = request;
    if (eventValue(event) === null) {
      return;
    }

    let s = this.data.get(series);
    if (s === undefined) {
      s = [event];
      this.data.set(series, s);
    } else {
      s.push(event);
    }
  }

  private indexOfTime(events: TSEvent[], time: Time): number {
    let lo = 0;
    let hi = events.length - 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const [timeBucket] = events[mid];
      if (timeBucket < time) {
        lo = mid + 1;
      } else if (timeBucket > time) {
        hi = mid - 1;
      } else {
        return mid;
      }
    }
    return lo;
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

  private get(request: StatsRequest<"get">): void {
    const { series, since, responsePort, agg } = request;
    const s = this.data.get(series);

    let payload: TSEvent[] | "not-found" = "not-found";
    if (s !== undefined) {
      payload = s;
      if (since !== undefined) {
        payload = payload.slice(this.indexOfTime(payload, since));
      }
      if (agg !== "none") {
        payload = rebucket(payload, AGG_MAP[agg.agg], agg.bucketLength);
      }
    }
    this.respond(responsePort, StatsResponse.get(payload));
  }
}
