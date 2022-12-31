---
description: Distributed ASCII Art is Great
---

# services/Stats

* Code: [https://github.com/abesto/bitburner-scripts-2/tree/main/src/services/Stats](https://github.com/abesto/bitburner-scripts-2/tree/main/src/services/Stats)
* Dependencies:
  * None for the service
  * None for sending data points to the service
  * [services-portregistry.md](services-portregistry.md "mention") for the client when reading data from the service
* In-game RAM: 1.60GB

<figure><img src="../.gitbook/assets/image (4).png" alt=""><figcaption><p>As Used in <a data-mention href="../other-binaries/bin-hwgw-monitor.md">bin-hwgw-monitor.md</a></p></figcaption></figure>

This is a time-series storage service, embedded in a game running in a browser pretending to be a distributed computing environment. Do I need to say more? Ok fine.

## Usage Example

```typescript
    // The Scheduler self-reporting latency aggregated into 1-second intervals
    timers.setInterval(() => {
      const latency = this.latency.splice(0, this.latency.length);
      this.stats.record("scheduler.latency.avg", agg.avg(latency));
      this.stats.record("scheduler.latency.p95", agg.p95(latency));
    }, 1000);
```

```typescript
  // `hwgw-monitor` fetching data
  fetch(
    metric: string,
    t0: number
  ): Promise<TSEvent[] | "not-found"> {
    return this.stats.get(metric, "none", this.now - t0 * this.sparklineWidth);
  }
```

## Storing Data

I did my best to find an existing time series storage solution I could embed, because this is known to be a hard non-standard data storage, retention, and querying problem. Unfortunately I failed to find anything I could use. So here we go reinventing the wheel!

The actual time-series implementation currently is just barely enough to work. Here's how it goes. At the moment, each time series is just an array of `[time: number; value: number]` pairs, stored at maximum resolution (i.e. as reported) for up to 10 minutes. This obviously needs smartness to degrade data over time to lower resolutions. However! This is the neat thing about services: that will be completely transparent to clients. Nothing else needs to change.

Every second the service looks at the data it has, and drops items older than 10 minutes. Simple.

## Querying Data

When you query a time series, you can optionally pass in the time buckets you want data to be aggregated into, and the aggregation function.

Consider: if we have second resolution data about scheduler latency, but only want to display one data point per minute, then there's no point shoving 60x as much data into the response. But how do you boil down 60 datapoints into 1? Only the client knows what makes sense for this particular query, so you can pass in `avg`, `min`, `p95`, etc., all the usual suspects.

## Visualizing Data

To be honest, this is the tricky part, and I didn't realize just how tricky it would be. Mapping a value range to one of the 8 partial vertical blocks is easy. That part lives in That's not the hard part. The actual visualization lives in [services-stats-sparklines.md](../libraries/services-stats-sparklines.md "mention").&#x20;

The hard part is displaying data that has 1-second resolution on a graph that has `0.750ms` resolution. And doing that without telling lies (too badly), and doing that without leaving gaps in the chart. It may be possible (or even a great idea) to look at how well-established open-source time series storage solutions deal with this problem. What did I do instead? I fiddled with ideas until I got charts that look roughly good enough maybe.

Here's the basic idea: start walking along the buckets of the output resolution. Keep an index into the input data. At each point ask: is this input data closer to _this_ bucket or the _next_ bucket? Act accordingly. Here's the code at the time of writing in all its glory:

```typescript
export function rebucket(
  events: TSEvent[],
  agg: Agg,
  bucketLength: Time
): TSEvent[] {
  if (!events.length) return [];
  const buckets: TSEvent[] = [];
  const timeMin = eventTime(events[0]);
  const timeMax = eventTime(events[events.length - 1]);
  let eventIndex = 0;
  for (let time = timeMin; time <= timeMax; time += bucketLength) {
    const bucketValues: Value[] = [];
    while (
      eventIndex < events.length &&
      Math.abs(eventTime(events[eventIndex]) - time) <
        Math.abs(eventTime(events[eventIndex]) - (time + bucketLength))
    ) {
      bucketValues.push(eventValue(events[eventIndex]));
      eventIndex++;
    }
    buckets.push([time, agg(bucketValues)]);
  }
  return buckets;
}
```

I don't want to look at it, it barely works, but hey, it's enough to draw pretty lines, and that's what it's all about!
