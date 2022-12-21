# TODOs

* `packup` -> `esbuild`
  * DONE deploy `.txt` files as is
  * DONE `/bin/` prefix for ts/js
  * figure out double-deployment in `bitburner-filesync` (both x and dist/x)
  * post in `#project-showcases` / send PR, add note about `window` / `document` etc
* hwgw
* break db lock if process is dead
* add `kill-batch` to supervisor
* add safety check to `hwgw`: when grow finishes, verify that money on server is good; kill hack jobs if not
* rename supervisor to scheduler
* add services to scheduler
  * configured in text file(s)
  * add service listing to `status`
  * simple-hack-distributed as service
  * configure? prefer running services on not-home
* add timers to scheduler?
  * configured in text file(s)
  * add `timers` listing to status
