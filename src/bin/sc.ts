// CLI to talk to SchedulerService
import { NS } from "@ns";
import { matchI } from "ts-adt";
import { withSchedulerClient } from "/services/Scheduler/client";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const args = ns.flags([
    ["threads", 0],
    ["stail", false],
  ]);
  const posArgs = args._ as string[];
  const command = posArgs[0];

  if (command === "start") {
    const threads = args.threads as number;
    if (threads <= 0) {
      ns.tprint("ERROR Invalid or missing --threads");
      return;
    }
    await withSchedulerClient(ns, async (client) => {
      ns.tprint(
        JSON.stringify(
          await client.start(
            {
              threads,
              script: posArgs[1],
              args: posArgs.slice(2),
            },
            args.stail as boolean,
            null
          )
        )
      );
    });
  } else if (command === "run") {
    const threads = args.threads as number;
    if (threads <= 0) {
      ns.tprint("ERROR Invalid or missing --threads");
      return;
    }
    await withSchedulerClient(ns, async (client) => {
      const response = await client.start(
        {
          threads,
          script: posArgs[1],
          args: posArgs.slice(2),
        },
        args.stail as boolean
      );
      ns.tprint(
        `INFO Started job ${response.jobId} with ${response.threads} threads, waiting for it to finish...`
      );
      await client.waitForJobFinished(response.jobId);
    });
    ns.tprint("INFO Job finished");
  }
}
