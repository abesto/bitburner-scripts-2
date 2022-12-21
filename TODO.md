# TODOs

* `packup` -> `esbuild`
  * DONE deploy `.txt` files as is
  * DONE `/bin/` prefix for ts/js
  * figure out double-deployment in `bitburner-filesync` (both x and dist/x)
  * post in `#project-showcases` / send PR, add note about `window` / `document` etc
* add locking to DB access
* subscriber-based `SupervisorEvents`
  * enforce listening for the event from a command via the API
* rename supervisor to scheduler
* add services to scheduler
  * configured in text file(s)
  * add service listing to `status`
  * simple-hack-distributed as service
  * configure? prefer running services on not-home
* add timers to scheduler?
  * configured in text file(s)
  * add `timers` listing to status
