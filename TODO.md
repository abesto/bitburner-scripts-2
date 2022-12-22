# TODOs

* renames:
  * supervisor/batch -> supervisor/job
  * supervisor/process? -> supervisor/task
* hwgw
  * add safety check to `hwgw-batch`: when grow finishes, verify that money on server is good; kill hack jobs if not
  * add safety check to `hwgw-batch`: if we fail to schedule all tasks, kill the whole batch
  * add safety check to `hwgw-controller`: if money goes significantly below threshold, kill everything and grow it back
  * add safety check to `hwgw-controller`: if security goes too high, kill everything and shrink it back
  * add nice reporting
* scheduler: immediately emit batchdone if threadcount=0
* scheduler: separate port for responses to each ... request?
* scheduler: pick server with best-match free mem
* make DB accessible from non-home hosts; scp fails way too often
* add timers to scheduler
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
