# TODOs

* renames:
  * supervisor/batch -> supervisor/job
  * supervisor/process? -> supervisor/task
* rewrite scheduler as proper client-server
* simple `share` service
* `parseMemory`, `parseTime` in `fmt` (may need to pull in `numeral` as an NPM module)
* scheduler: assign task id to each task, pass that along with the job id
  * optimize payloads: get task ID for done-reporting from args
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
* scheduler
  * add `status <batch-id>`
  * add `tail <batch-id>`
  * immediately emit batchdone if threadcount=0
  * separate port for responses to each ... request?
  * pick server with best-match free mem
* `PortRegistry`
  * implement safe restart (transfer internal state)
* make DB accessible from non-home hosts; scp fails way too often
* add timers to scheduler?
  * configured in text file(s)
  * add `timers` listing to status
* add services to scheduler
  * configured in text file(s)
  * add service listing to `status`
  * simple-hack-distributed as service
  * configure? prefer running services on not-home
* `config get` / `config set`
  * autocomplete keys
  * validation on `config set`
