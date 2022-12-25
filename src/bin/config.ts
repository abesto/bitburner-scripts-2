import { AutocompleteData, NS } from '@ns';

import { DEFAULT_DB } from '/database';
import { highlightValue } from '/fmt';
import { Log } from '/log';
import { db, dbLock } from '/services/Database/client';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "config");

  const command = ns.args[0] as string;
  if (command === "get") {
    const key = ns.args[1] as string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let obj = (await db(ns, log)).config as any;
    if (key) {
      const path = key.split(".");
      for (const part of path) {
        obj = obj[part];
        if (obj === undefined) {
          break;
        }
      }
    }

    ns.tprintf(highlightValue(obj));
  } else if (command === "set") {
    const key = ns.args[1] as string;
    const value = ns.args[2] as string;
    if (!key || !value) {
      log.terror("Usage: run config.js set <key> <value>");
      return;
    }

    await dbLock(ns, log, async (memdb) => {
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
        log.terror("Parent not found", { key });
        return;
      }

      const lastPart = path[path.length - 1];
      const oldValue = obj[lastPart];
      if (typeof oldValue === "object") {
        log.terror("Not a leaf", { key, oldValue });
        return;
      }
      if (typeof oldValue !== typeof value) {
        log.terror("Type mismatch", { key, oldValue, value });
        return;
      }
      obj[lastPart] = value;
      log.tinfo("Saved", { key, oldValue, value });
      return memdb;
    });
  } else {
    log.terror("Usage: run config.js set <key> <value>");
  }
}

export function autocomplete(data: AutocompleteData, args: string[]): string[] {
  if (args.length <= 1) {
    return ["get", "set"];
  } else if (args.length === 2) {
    const shape = DEFAULT_DB.config;
    const parts = args[1].split(".");
    const matched: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
