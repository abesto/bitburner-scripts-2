import { AutocompleteData, NS } from '@ns';

import { Log } from '/log';
import { withClient } from '/services/client_factory';
import { SchedulerClient } from '/services/Scheduler/client';
import { HostAffinity } from '/services/Scheduler/types';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "prepare-host");
  const host = ns.args[0] as string;
  if (!host) {
    log.terror("No host specified");
    return;
  }
  await withClient(SchedulerClient, ns, log, async (client) => {
    const resp = await client.start(
      {
        script: "/bin/hwgw-batch.js",
        args: ["--initial", host],
        threads: 1,
        hostAffinity: HostAffinity.preferToRunOn({ host: "home" }),
      },
      true,
      null
    );
    log.tinfo("Started --initial batch", { host, jobId: resp.jobId });
  });
}

export function autocomplete(data: AutocompleteData): string[] {
  return data.servers;
}
