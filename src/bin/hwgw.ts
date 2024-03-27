import { AutocompleteData, NS } from "@ns";

import { Log } from "/log";
import { PortRegistryClient } from "/services/PortRegistry/client";
import { SchedulerClient } from "/services/Scheduler/client";
import { HostAffinity } from "/services/Scheduler/types";

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "hwgw-controller");

  const portRegistryClient = new PortRegistryClient(ns, log);
  const schedulerResponsePort = await portRegistryClient.reservePort();
  const schedulerClient = new SchedulerClient(ns, log, schedulerResponsePort);

  const resp = await schedulerClient.start(
    {
      script: "bin/hwgw-controller.js",
      args: ns.args.map((arg) => arg.toString()),
      threads: 1,
      hostAffinity: HostAffinity.mustRunOn({ host: "home" }),
    },
    { nohup: true }
  );
  if (resp.threads === 0) {
    log.terror("Failed to start job", { resp });
  } else {
    log.tinfo("Controller started", { resp });
  }
}

export function autocomplete(data: AutocompleteData, args: string[]): string[] {
  if (args.length === 1) {
    return data.servers.filter((server) => server.startsWith(args[0]));
  }
  return [];
}
