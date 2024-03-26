---
description: The Gnarly Bits
---

# bin/boot

This is the first script you should run after a fresh start of Bitburner to bring up the basics of our service-based infrastructure.

There's an unavoidable(?) circular dependency between [`PortRegistry`](../services/services-portregistry.md), [`Database`](../services/services-database.md), and [`Scheduler`](../services/services-scheduler.md).  `/bin/boot` starts them in the correct order, and applies some low-level plumbing to connect them all up.

Check out the code for details; roughly, it goes like this:

* Drop all messages from service ports
* Start `PortRegistry`
* Start `Database`
* Inject the `PortRegistry` and `Database` services into the `Scheduler` database
* Start `Scheduler`

`bin/boot` is _very_ conservative: if anything goes wrong, it immediately stops, instead of trying to fix it. The safest way to use it is to kill all running scripts, then run `bin/boot`.
