import { AutocompleteData, NS } from "@ns";

import { autonuke } from "/autonuke";
import { db } from "/database";
import { Fmt } from "/fmt";
import { SupervisorCtl } from "/supervisorctl";
import { SupervisorEvents } from "/supervisorEvent";

export async function main(ns: NS): Promise<void> {
  const args = ns.flags([]);
  const posArgs = args._ as string[];
  const host = posArgs[0];

  const supervisorctl = new SupervisorCtl(ns);
  const supervisorEvents = new SupervisorEvents(ns);

  if (!host) {
    ns.tprint("ERROR No host specified");
    return;
  }

  ns.disableLog("ALL");
  const fmt = new Fmt(ns);
  const spacing = async () => (await db(ns)).config.hwgw.spacing;

  autonuke(ns, host);

  // eslint-disable-next-line no-constant-condition
  ns.print("Initial preparation: weaken, grow, weaken");
  while (shouldWeaken() || (await shouldGrow())) {
    const requestId = await supervisorctl.start(
      "/dist/bin/hwgw-batch.js",
      [host, "--initial"],
      1,
      true
    );
    ns.print(`Starting batch with request id ${requestId}`);
    const { batchId } = await supervisorEvents.waitForBatchStarted(requestId);
    ns.print(`Batch started with id ${batchId}`);
    await supervisorEvents.waitForBatchDone(batchId);
  }

  ns.print("Starting batched hacking");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    ns.print("Starting batch");
    await supervisorctl.start("/dist/bin/hwgw-batch.js", [host], 1, true);
    await report();
    await ns.sleep((await spacing()) * 5);
  }

  async function report() {
    const memdb = await db(ns);
    const countByKind = { batch: 0, hack: 0, weaken: 0, grow: 0 };
    for (const batch of Object.values(memdb.supervisor.batches)) {
      if (
        batch.script.endsWith("/bin/hwgw-batch.js") &&
        batch.args[0] === host
      ) {
        countByKind.batch += batch.threads;
      } else if (
        batch.script.endsWith("/dist/bin/payloads/hack.js") &&
        batch.args[0] === host
      ) {
        countByKind.hack += batch.threads;
      } else if (
        batch.script.endsWith("/dist/bin/payloads/weaken.js") &&
        batch.args[0] === host
      ) {
        countByKind.weaken += batch.threads;
      } else if (
        batch.script.endsWith("/dist/bin/payloads/grow.js") &&
        batch.args[0] === host
      ) {
        countByKind.grow += batch.threads;
      }
    }

    ns.print(
      `Batches: ${countByKind.batch} Hacks: ${countByKind.hack} Weaken: ${countByKind.weaken} Grow: ${countByKind.grow}`
    );
  }

  function shouldWeaken(): boolean {
    const minSecurity = ns.getServerMinSecurityLevel(host);
    const currentSecurity = ns.getServerSecurityLevel(host);

    if (currentSecurity > minSecurity) {
      ns.print(
        `Security ${currentSecurity} > ${minSecurity} -> needs weakening ${host}`
      );
      return true;
    }
    return false;
  }

  async function shouldGrow(): Promise<boolean> {
    const moneyAvailable = ns.getServerMoneyAvailable(host);
    const moneyCapacity = ns.getServerMaxMoney(host);
    const threshold = (await db(ns)).config.hwgw.moneyThreshold * moneyCapacity;

    if (moneyAvailable < threshold) {
      ns.print(
        `Money ${fmt.money(moneyAvailable)} < ${fmt.money(
          threshold
        )} -> needs growing ${host}`
      );
      return true;
    }
    return false;
  }
}

export function autocomplete(data: AutocompleteData, args: string[]): string[] {
  if (args.length === 1) {
    return data.servers.filter((server) => server.startsWith(args[0]));
  }
  return [];
}
