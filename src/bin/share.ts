import { NS } from "@ns";
import { Fmt } from "/fmt";
import { SupervisorCtl } from "/supervisorctl";
import { SupervisorEvents } from "/supervisorEvent";

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([["mem", 0]]);
  const fmt = new Fmt(ns);

  const targetMemory = args.mem as number;
  if (targetMemory <= 0) {
    throw new Error("Usage: run share.js --mem <memory>");
  }
  const script = "/dist/bin/payloads/share.js";
  const scriptMem = ns.getScriptRam(script);
  const targetThreads = Math.floor(targetMemory / scriptMem);
  ns.print(
    `Running ${script} with ${targetThreads} threads, each using ${fmt.memory(
      scriptMem
    )} RAM, for a total of ${fmt.memory(targetThreads * scriptMem)} RAM`
  );

  const supervisorCtl = new SupervisorCtl(ns);
  const supervisorEvents = new SupervisorEvents(ns);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const requestId = await supervisorCtl.start(script, [], targetThreads);
    const { batchId, threads } = await supervisorEvents.waitForBatchStarted(
      requestId
    );
    ns.print(`Batch ${batchId} started with ${threads} threads`);
    await supervisorEvents.waitForBatchDone(batchId);
  }
}
