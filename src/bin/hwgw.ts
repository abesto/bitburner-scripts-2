import { AutocompleteData, NS } from "@ns";

import * as layout from "/layout";
import { Log } from "/log";
import { PortRegistryClient } from "/services/PortRegistry/client";
import { SchedulerClient } from "/services/Scheduler/client";
import { HostAffinity, Job } from "/services/Scheduler/types";

const USAGE = `
Usage: hwgw <command>

COMMANDS:
  start <hostname>
  kill <hostname>
  tail <hostname>
  monitor [hostname]
`;

class HwgwCli {
  private constructor(
    private readonly ns: NS,
    private readonly log: Log,
    private readonly schedulerClient: SchedulerClient
  ) {}

  static async new(ns: NS, log: Log): Promise<HwgwCli> {
    const portRegistryClient = new PortRegistryClient(ns, log);
    const schedulerResponsePort = await portRegistryClient.reservePort();
    const schedulerClient = new SchedulerClient(ns, log, schedulerResponsePort);
    return new HwgwCli(ns, log, schedulerClient);
  }

  async findJob(script: string, hostname: string): Promise<Job | undefined> {
    const schedulerStatus = await this.schedulerClient.status();
    const jobs = schedulerStatus.jobs;
    return jobs.find(
      (job) => job.spec.script === script && job.spec.args.includes(hostname)
    );
  }

  async start(hostname: string) {
    const job = await this.findJob("bin/hwgw-controller.js", hostname);
    if (job) {
      this.log.tinfo("Already running", { job });
      return;
    }

    const resp = await this.schedulerClient.start(
      {
        script: "bin/hwgw-controller.js",
        args: [hostname, ...this.ns.args.map((arg) => arg.toString())],
        threads: 1,
        hostAffinity: HostAffinity.mustRunOn({ host: "home" }),
      },
      { nohup: true }
    );
    if (resp.threads === 0) {
      this.log.terror("Failed to start job", { resp });
    } else {
      this.log.tinfo("Controller started", { resp });
    }
  }

  async kill(hostname: string) {
    const job = await this.findJob("bin/hwgw-controller.js", hostname);
    if (!job) {
      this.log.tinfo("Not running", { hostname });
      return;
    }

    const response = await this.schedulerClient.killJob(job.id);
    this.log.tinfo("Controller killed", { response, job });
  }

  async tail(hostname: string) {
    const job = await this.findJob("bin/hwgw-controller.js", hostname);
    if (!job) {
      this.log.tinfo("Not running", { hostname });
      return;
    }

    const response = await this.schedulerClient.tailTask(job.id);
    await layout.hwgwController(this.ns, job.tasks[0].pid);
    this.log.tinfo("Controller tail", { response, job });
  }

  async monitorHost(hostname: string) {
    const job = await this.findJob("bin/hwgw-monitor.js", hostname);
    let pid;

    if (job) {
      pid = job.tasks[0].pid;
    } else {
      const resp = await this.schedulerClient.start({
        script: "bin/hwgw-monitor.js",
        args: [hostname],
        threads: 1,
      });
      if (resp.threads === 0) {
        this.log.terror("Failed to start monitor job", { resp });
        return;
      } else {
        this.log.tinfo("Monitor started", { resp });
        const schedulerStatus = await this.schedulerClient.status();
        const job = schedulerStatus.jobs.find((job) => job.id === resp.jobId);
        if (!job) {
          this.log.terror("Failed to find we just started, crashed?", { resp });
          return;
        }
        pid = job.tasks[0].pid;
      }
    }

    await layout.hwgwMonitor(this.ns, pid);
  }

  async monitorOverview() {
    const job = await this.findJob("bin/hwgw-monitor.js", "--overview");
    let pid;

    if (job) {
      pid = job.tasks[0].pid;
    } else {
      const resp = await this.schedulerClient.start({
        script: "bin/hwgw-monitor.js",
        args: ["--overview"],
        threads: 1,
      });
      if (resp.threads === 0) {
        this.log.terror("Failed to start monitor job", { resp });
        return;
      } else {
        this.log.tinfo("Monitor started", { resp });
        const schedulerStatus = await this.schedulerClient.status();
        const job = schedulerStatus.jobs.find((job) => job.id === resp.jobId);
        if (!job) {
          this.log.terror("Failed to find we just started, crashed?", { resp });
          return;
        }
        pid = job.tasks[0].pid;
      }
    }

    await layout.hwgwMonitor(this.ns, pid);
  }
}

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "hwgw");
  const command = ns.args.shift() as string;
  const client = await HwgwCli.new(ns, log);
  const hostname = ns.args.shift() as string;

  if (command === "start") {
    if (!hostname) {
      log.terror(USAGE);
      return;
    }
    return await client.start(hostname);
  }

  if (command === "kill") {
    if (!hostname) {
      log.terror(USAGE);
      return;
    }
    return await client.kill(hostname);
  }

  if (command === "tail") {
    if (!hostname) {
      log.terror(USAGE);
      return;
    }
    return await client.tail(hostname);
  }

  if (command === "monitor") {
    if (hostname) {
      return await client.monitorHost(hostname);
    }
    return await client.monitorOverview();
  }

  log.terror(USAGE);
}

export function autocomplete(data: AutocompleteData, args: string[]): string[] {
  const commands = ["start", "kill", "tail", "monitor"];
  const cmd = args[0];
  if (cmd === undefined) {
    return commands;
  } else if (args.length === 1) {
    return commands.filter((command) => command.startsWith(args[0]));
  } else {
    return data.servers.filter((server) => server.startsWith(args[1]));
  }
}
