import { AutocompleteData, NS } from "@ns";
import { db, dbLock, DEFAULT_DB } from "/database";

export async function main(ns: NS): Promise<void> {
  const command = ns.args[0] as string;
  if (command === "get") {
    const key = ns.args[1] as string;
    let obj = (await db(ns)).config as any;
    if (key) {
      const path = key.split(".");
      for (const part of path) {
        obj = obj[part];
        if (obj === undefined) {
          break;
        }
      }
    }
    let output = JSON.stringify(obj, null);
    if (output.length > 100) {
      output = JSON.stringify(obj, null, 2);
    }
    ns.tprint(output);
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
      const oldValue = obj[lastPart];
      if (typeof oldValue === "object") {
        ns.tprint(
          `ERROR ${key} is not a leaf node: ${JSON.stringify(oldValue)}`
        );
        return;
      }
      if (typeof oldValue !== typeof value) {
        ns.tprint(
          `ERROR ${key} is ${typeof oldValue} but ${value} is ${typeof value}`
        );
        return;
      }
      obj[lastPart] = value;
      ns.tprint(`Set ${key} to ${value}`);
      return memdb;
    });
  } else {
    throw new Error("Usage: run config.js <get|set>");
  }
}

export function autocomplete(data: AutocompleteData, args: string[]): string[] {
  if (args.length <= 1) {
    return ["get", "set"];
  } else if (args.length === 2) {
    const shape = DEFAULT_DB.config;
    const parts = args[1].split(".");
    const matched: string[] = [];
    let obj = shape as any;
    for (const part of parts) {
      if (obj[part] === undefined) {
        const options = [];
        for (const key of Object.keys(obj)) {
          let option = matched.concat(key).join(".");
          if (typeof obj[key] === "object") {
            option += ".";
          }
          options.push(option);
        }
        return options;
      }
      obj = obj[part];
      matched.push(part);
    }
  }
  return [];
}
