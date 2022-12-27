# TODOs

* `BuyWorkers`
  * make decisions without config
* `hwgw-controller`: kill all processes against the target on startup?
* `HwgwBatchViz` service
  * Configure: filter for host
* Create `Hwgw` service
  * Replace / extend `hwgw-controller`
  * Detect JS runtime overload, *do something* (maybe: kill all batches, drop `maxDepth` config)
* Create `Stats` service
  * chart used/total capacity
  * charts per hwgw controller
  * charts for income per income source
* `Database` service
  * config cache class on top of `DatabaseClient` (with configurable TTL)
  * compress the data put on the port with `lz-string`? (we're more CPU bottlenecked though I think)
  * turn into key-value database instead of a glorified file lock (Redis query syntax?)
* `Scheduler` service
  * add `status <job-id>`
  * monitor / alert on scheduling latency
  * monitor / alert on job finish notification latency?
  * extend `CrashWatcher` to alert if the `Scheduler` dies
  * include core count in 1. scheduling decisions 2. thread count accounting
* `parseMemory`, `parseTime` in `fmt` (may need to pull in `numeral` as an NPM module)
* `PortRegistry` service
  * implement safe restart (transfer internal state)
* persistent alerts about badness via UI (so that badness is known even while focusing on faction work or w/e)
* logging lib
  * levels, filtering configured via `database.config`