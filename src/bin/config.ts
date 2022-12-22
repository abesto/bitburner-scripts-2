import { NS } from "@ns";
import { db, dbLock } from "/database";

export async function main(ns: NS): Promise<void> {
  const command = ns.args[0] as string;
  if (command === "get") {
    const key = ns.args[1] as string;
    if (!key) {
      throw new Error("Usage: run config.js get <key>");
    }
    let obj = (await db(ns)).config as any;
    const path = key.split(".");
    for (const part of path) {
      obj = obj[part];
      if (obj === undefined) {
        break;
      }
    }
    ns.tprint(obj);
  } else if (command === "set") {
    const key = ns.args[1] as string;
    const value = ns.args[2] as string;
    if (!key || !value) {
      throw new Error("Usage: run config.js set <key> <value>");
    }

    await dbLock(ns, "set", async (memdb) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let obj = memdb.config as any;
      const path = key.split(".");
      for (const part of path.slice(0, -1)) {
        obj = obj[part];
        if (obj === undefined) {
          break;
        }
      }

      if (obj === undefined) {
        throw new Error(`Could not find parent of ${key}`);
      }

      const lastPart = path[path.length - 1];
      obj[lastPart] = value;
      return memdb;
    });
    ns.tprint(`Set ${key} to ${value}`);
  } else {
    throw new Error("Usage: run config.js <get|set>");
  }
}
