# TODOs

* `packup` -> `esbuild`
  * DONE get rid of double-deploy
  * DONE deploy `.txt` files as is
  * DONE `/bin/` prefix for ts/js
  * post in `#project-showcases` / send PR, add note about `window` / `document` etc
* move from `minimist` to `ns.flags`
  * https://github.com/danielyxie/bitburner/blob/dev/markdown/bitburner.ns.flags.md
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
