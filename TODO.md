# TODOs

* `HwgwBatchViz` service
  * Configure: bias for past vs future jobs (`howCenter` multiplier)
  * Configure: filter for host
  * Add command to open log window with correct size
* Create `Hwgw` service
  * manage multiple `hwgw-controller`s
* Create `Stats` service
  * chart used/total capacity
  * charts per hwgw controller
  * charts for income per income source
* `Database` service
  * `db` CLI, supported by a `status` API call
  * config cache class on top of `DatabaseClient` (with configurable TTL)
  * compress the data put on the port with `lz-string`? (we're more CPU bottlenecked though I think)
  * turn into key-value database instead of a glorified file lock (Redis query syntax?)
* logging lib
  * levels, filtering configured via `database.config`
* `Scheduler` service
  * add `status <job-id>`
  * add `drain <host>` for use when buying new servers
  * monitor / alert on scheduling latency
  * monitor / alert on job finish notification latency?
  * extend `CrashWatcher` to alert if the `Scheduler` dies
  * include core count in 1. scheduling decisions 2. thread count accounting
* `parseMemory`, `parseTime` in `fmt` (may need to pull in `numeral` as an NPM module)
* hwgw logic
  * Do the stalefish dance
  * add safety check to `hwgw-batch`: when grow finishes, verify that money on server is good; kill hack jobs if not
  * add safety check to `hwgw-batch`: if we fail to schedule all tasks, kill the whole batch
  * add safety check to `hwgw-controller`: if money goes significantly below threshold, kill everything and grow it back
  * add safety check to `hwgw-controller`: if security goes too high, kill everything and shrink it back
  * `hwgw-controller`: kill all processes against the target on startup
  * add nice reporting
    * including: memory usage over time
* `PortRegistry` service
  * implement safe restart (transfer internal state)
* `BuyWorkers`
  * make decisions without config
* persistent alerts about badness via UI (so that badness is known even while focusing on faction work or w/e)
