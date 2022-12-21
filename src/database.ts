import { NS } from "@ns";
import { deepmerge } from "deepmerge-ts";
import { dbLockPort } from "./ports";

export type DB = {
  config: {
    simpleHack: {
      // Defines how much money a server should have before we hack it
      moneyThreshold: number;
      // // Defines the maximum security level the target server can have over its minimum
      securityThreshold: number;
    };
    supervisor: {
      reserveHomeRam: number;
    };
  };
  supervisor: SupervisorDB;
};

export type SupervisorDB = {
  batches: { [batchID: string]: SupervisorBatch };
};

export type SupervisorBatch = {
  script: string;
  args: string[];
  threads: number;
  deployments: {
    [hostname: string]: {
      pid: number;
      threads: number;
    };
  };
};

const DB_PATH = "/db.json.txt";

const DEFAULT_DB: DB = {
  config: {
    simpleHack: {
      moneyThreshold: 0.75,
      securityThreshold: 5,
    },
    supervisor: {
      reserveHomeRam: 8,
    },
  },
  supervisor: {
    batches: {},
  },
};

export async function dbLock(
  ns: NS,
  fn: (db: DB) => Promise<DB | undefined>
): Promise<void> {
  if (ns.getHostname() !== "home") {
    throw new Error("dbLock() can only be called from home");
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const pid = ns.getRunningScript()!.pid;
  const port = dbLockPort(ns);

  while (!port.empty()) {
    ns.print("Waiting for db lock");
    await port.nextWrite();
  }
  port.write(`lock:${pid}`);

  let retval;
  try {
    const newDb = await fn(db(ns));
    if (newDb !== undefined) {
      saveDb(ns, newDb);
    }
  } finally {
    port.write(`unlock:${pid}`); // to trigger `nextWrite()`
    port.clear();
  }

  return retval;
}

export function db(ns: NS): DB {
  if (ns.getHostname() !== "home") {
    throw new Error("db() can only be called from home");
  }
  if (!ns.fileExists(DB_PATH)) {
    ns.write(DB_PATH, "{}", "w");
  }
  const contents = JSON.parse(ns.read("/db.json"));
  return deepmerge(DEFAULT_DB, contents);
}

function saveDb(ns: NS, db: DB): void {
  if (ns.getHostname() !== "home") {
    throw new Error("saveDb() can only be called from home");
  }
  ns.write(DB_PATH, JSON.stringify(db, null, 4), "w");
}
