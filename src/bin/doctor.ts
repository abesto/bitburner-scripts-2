import { NS } from "@ns";

import { fields, TypeNames, variantModule, VariantOf } from "variant";

import { highlightJSON } from "/fmt";
import { Log } from "/log";
import { PORTS } from "/ports";
import { withClient } from "/services/client_factory";
import { DatabaseClient } from "/services/Database/client";

const R = variantModule({
  pass: fields<{ message: string }>(),
  fail: fields<{ message: string }>(),
});
type RNT = TypeNames<typeof R>;
export type R<T extends RNT = undefined> = VariantOf<typeof R, T>;

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "doctor");

  const args = ns.flags([["verbose", false]]);
  const verbose = args.verbose as boolean;

  const checks: { [name: string]: () => Promise<R[]> } = {
    ports: async () => {
      return Object.entries(PORTS).map(([name, port]) => {
        const expected = name === "FreePorts" ? "FULL" : "NOT FULL";
        const actual = ns.getPortHandle(port).full() ? "FULL" : "NOT FULL";
        if (expected === actual) {
          return R.pass({
            message: `Server port ${port} (${name}) is ${actual}`,
          });
        } else {
          return R.fail({
            message: `Server port ${port} (${name}) is ${actual}`,
          });
        }
      });
    },

    dbLock: async () => {
      return withClient(DatabaseClient, ns, log, async (client) => {
        const status = await client.status();
        return [
          status.currentLock === null
            ? R.pass({ message: "No lock" })
            : R.fail({
                message: `Lock exists: ${highlightJSON(status.currentLock)}`,
              }),

          status.lockQueue.length === 0
            ? R.pass({ message: "No lock queue" })
            : R.fail({
                message: `Lock queue: ${highlightJSON(status.lockQueue)}`,
              }),
        ];
      });
    },

    schedulerUp: async () => {
      if (ns.isRunning("bin/services/Scheduler.js")) {
        return [R.pass({ message: "Scheduler is running" })];
      } else {
        return [R.fail({ message: "Scheduler is not running" })];
      }
    },
  };

  let pass = 0,
    fail = 0;
  for (const [name, check] of Object.entries(checks)) {
    for (const result of await check()) {
      if (result.type === "pass") {
        pass += 1;
        if (verbose) {
          log.tinfo(name, { pass: result.message });
        }
      } else {
        fail += 1;
        log.twarn(name, { fail: result.message });
      }
    }
  }

  log.tinfo("Summary", { pass, fail });
}
