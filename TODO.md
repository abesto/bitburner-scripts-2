# TODOs

* handle ports getting full
* database service (with a lock queue)
* `Scheduler`
  * add `status <job-id>`
  * add `tail <job-id>` (taskid=0)
  * add `tail <job-id>:<task-id>`
  * custom request type / maybe a flag for `CrashWatcher` - suppress logs if the task is already gone (boring race condition)
* add services to scheduler
  * configured in text file(s)
  * add service listing to `status`
* simple `share` service
* `parseMemory`, `parseTime` in `fmt` (may need to pull in `numeral` as an NPM module)
* scheduler:
  * include core count in 1. scheduling decisions 2. thread count accounting
* hwgw
  * add safety check to `hwgw-batch`: when grow finishes, verify that money on server is good; kill hack jobs if not
  * add safety check to `hwgw-batch`: if we fail to schedule all tasks, kill the whole batch
  * add safety check to `hwgw-controller`: if money goes significantly below threshold, kill everything and grow it back
  * add safety check to `hwgw-controller`: if security goes too high, kill everything and shrink it back
  * `hwgw-controller`: kill all processes against the target on startup
  * add nice reporting
* `hwgw-orchestrator`: manage multiple `hwgw-controller`s and the `hwgw` config
* `hwgw-simulator`: for given parameters, how much capacity do we need for hwgw against a host?
* capacity management - reserve ram for full hwgw batch
* `PortRegistry`
  * implement safe restart (transfer internal state)
* `config get` / `config set`
  * autocomplete keys
  * validation on `config set`
