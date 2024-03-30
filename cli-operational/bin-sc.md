---
description: Manage the Scheduler
---

# bin/sc

`sc` is short for "Scheduler Control". It's the CLI used to manage the [`Scheduler`](../services/services-scheduler.md).

Refresher on important nouns (refer to [services/Scheduler: Workload Management](../services/services-scheduler.md#workload-management) for more details):

* Service: a long-running, unique process
* Job: a one-off execution of an arbitrary script with a configurable number of threads. Possibly split across multiple hosts. Has _at least_ one Task.
* Task: an actual Bitburner process. Part of a Job.

Run `sc` without any arguments to get usage information. For reference, here's a snapshot at 2024-03-26:

```
Usage: sc <command> [args]

SCHEDULER OPERATIONS:
  start-daemon    Start the scheduler daemon
  stop-daemon     Stop the scheduler daemon
  restart-daemon  Restart the scheduler daemon
  tail-daemon     Tail logs of the scheduler daemon
  capacity        Show capacity of all hosts

SERVICE OPERATIONS:
  services               Show all services
  reload                 Reload service specs
  service-status <name>  Show status of a service
  start-service <name>   Start a service
  stop-service <name>    Stop a service
  restart-service <name> Restart a service
  enable-service <name>  Enable a service: keep it running
  disable-service <name> Disable a service
  tail-service <name>    Tail logs of a service

JOB OPERATIONS:
  status           Show status of all jobs
  start            Start a job
  run              Start a job and wait for it to finish
  kill-all         Kill all jobs
  kill-job <jobId> Kill a job
  tail-task <jobId> <taskId>
      Tail logs of a task. Use 'status --verbose' to find 'jobId' and 'taskId'.

OPTIONS:
  --threads <n>  Number of threads to use (start, run)
  --stail        Tail logs of the started job (start, run, start-daemon)
  --verbose      Show more details (status, capacity, service-status)
```
