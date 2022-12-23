// CLI to talk to SchedulerService
import { AutocompleteData, NS } from "@ns";
import { matchI } from "ts-adt";
import { Fmt } from "/fmt";
import {
  NoResponseSchedulerClient,
  withSchedulerClient,
} from "/services/Scheduler/client";
import { jobThreads } from "/services/Scheduler/types";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const args = ns.flags([
    ["threads", 0],
    ["stail", false],
    ["verbose", false],
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
  } else if (command === "status") {
    const status = await withSchedulerClient(ns, async (client) => {
      return await client.status();
    });
    ns.tprint("INFO Scheduler status:");
    for (const job of status.jobs) {
      ns.tprint(
        `  [${job.id}] '${job.spec.script} ${job.spec.args.join(
          " "
        )}' threads: ${jobThreads(job)} / ${job.spec.threads}`
      );
      if (args.verbose as boolean) {
        for (const task of Object.values(job.tasks)) {
          ns.tprint(
            `      ${task.id} threads=${task.threads} ${task.hostname} PID ${task.pid}`
          );
        }
      }
    }
  } else if (command === "exit") {
    await new NoResponseSchedulerClient(ns).exit();
    ns.tprint("INFO Exit request sent");
  } else if (command === "kill-all") {
    await new NoResponseSchedulerClient(ns).killAll();
    ns.tprint("INFO kill-all request sent");
  } else if (command === "kill-job") {
    const jobId = posArgs[1];
    if (!jobId) {
      ns.tprint("ERROR Missing job ID");
      return;
    }
    await withSchedulerClient(ns, async (client) => {
      ns.tprint((await client.killJob(jobId)).result);
    });
  } else if (command === "capacity") {
    const { capacity } = await withSchedulerClient(ns, async (client) => {
      return await client.capacity();
    });
    capacity.sort((a, b) => a.freeMem - b.freeMem);
    const totalMem = capacity.reduce((acc, c) => acc + c.totalMem, 0);
    const freeMem = capacity.reduce((acc, c) => acc + c.freeMem, 0);
    const hosts = capacity.length;
    const fmt = new Fmt(ns);
    ns.tprint(
      `INFO Capacity: ${hosts} hosts, ${fmt.memory(freeMem)} / ${fmt.memory(
        totalMem
      )}`
    );

    const smallestChunk = capacity.find((c) => c.freeMem > 0)?.freeMem;
    if (smallestChunk) {
      ns.tprint(`INFO Smallest chunk: ${fmt.memory(smallestChunk)}`);
    }

    const largestChunk = capacity[capacity.length - 1]?.freeMem;
    if (largestChunk) {
      ns.tprint(`INFO Largest chunk: ${fmt.memory(largestChunk)}`);
    }
  } else {
    ns.tprint(`ERROR Invalid command: ${command}`);
  }
}

export function autocomplete(data: AutocompleteData, args: string[]): string[] {
  const commands = [
    "start",
    "run",
    "exit",
    "status",
    "kill-all",
    "kill-job",
    "capacity",
  ];
  if (args.length === 0) {
    return commands;
  } else if (args.length === 1) {
    return commands.filter((c) => c.startsWith(args[0]));
  } else if (args[0] === "start" || args[0] === "run") {
    return data.scripts.filter((s) => s.startsWith(args[1]));
  } else {
    return [];
  }
}
