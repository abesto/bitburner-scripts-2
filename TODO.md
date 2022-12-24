# TODOs

* import sorter for `.ts` files
* `config` / `config`
  * syntax highlighting on `config.get`
* database service (with a lock queue)
  * client: read the db from disk if we're on `home` (but always lock/write through the service)
  * client: caching reader for config (with configurable TTL)
* pid lookup occasionally fails because `getRunningScript()` is somehow null. centralize lookup to a single location and cache it.
* logging lib
  * formatting, colors
  * levels
  * named (hierarchical?) loggers
  * configured via `database.config`
  * pull in some existing lib maybe?
  * persistent alerts about badness via UI (so that badness is known even while focusing on faction work or w/e)
* `Scheduler`
  * add `status <job-id>`
  * add `tail <job-id>` (taskid=0)
  * add `tail <job-id>:<task-id>`
  * monitor / alert on scheduling latency
  * monitor / alert on job finish notification latency?
  * extend `CrashWatcher` to alert if the `Scheduler` dies
  * nice formatting for service status, a 'la systemd
  * `reload`: restart services whose spec changed
  * tiny `CrashWatcherWatcher` service for redundancy
* `share`
  * turn into service
  * automatically make decisions about used memory
* `parseMemory`, `parseTime` in `fmt` (may need to pull in `numeral` as an NPM module)
* scheduler:
  * include core count in 1. scheduling decisions 2. thread count accounting
* hwgw
  * add safety check to `hwgw-batch`: when grow finishes, verify that money on server is good; kill hack jobs if not
  * add safety check to `hwgw-batch`: if we fail to schedule all tasks, kill the whole batch
  * add safety check to `hwgw-controller`: if money goes significantly below threshold, kill everything and grow it back
  * add safety check to `hwgw-controller`: if security goes too high, kill everything and shrink it back
  * `hwgw-controller`: kill all processes against the target on startup
  * factor in Hacking skill growth when starting new batches (skill up -> ETA down, might mess up ordering of finishing tasks)
  * add nice reporting
    * including: memory usage over time
* `hwgw-orchestrator`: manage multiple `hwgw-controller`s and the `hwgw` config
* `hwgw-simulator`: for given parameters, how much capacity do we need for hwgw against a host?
* capacity management - reserve ram for full hwgw batch
* `PortRegistry`
  * implement safe restart (transfer internal state)
* `hacknet`
  * turn into service, autobuy (maybe with money reserve)
* `stock`
  * turn into service
  * break watcher out into separate service?
  * add short option, do something fun there with hacking maybe?
* `BuyWorkers`
  * make decisions without config
* `Stats` service?
