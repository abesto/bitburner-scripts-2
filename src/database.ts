import { NS } from "@ns";
import { deepmerge } from "deepmerge-ts";
import { dbLockPort } from "./ports";

export type DB = {
  config: {
    database: {
      debugLocks: boolean;
    };
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
  pending: {
    when: number;
    script: string;
    args: string[];
    threads: number;
    requestId: string;
  }[];
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
    database: {
      debugLocks: false,
    },
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
    pending: [],
  },
};

export async function dbLock(
  ns: NS,
  what: string,
  fn: (db: DB) => Promise<DB | undefined>
): Promise<void> {
  if (ns.getHostname() !== "home") {
    throw new Error("dbLock() can only be called from home");
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const pid = ns.getRunningScript()!.pid;
  const port = dbLockPort(ns);

  while (!port.empty()) {
    ns.print(`Waiting for db lock: ${pid}/${what}`);
    await port.nextWrite();
  }
  port.write(`lock:${pid}`);
  if (db(ns).config.database.debugLocks) {
    ns.print(`Got db lock: ${pid}/${what}`);
  }

  let retval;
  try {
    const newDb = await fn(db(ns));
    if (newDb !== undefined) {
      saveDb(ns, newDb);
    }
  } finally {
    port.write(`unlock:${pid}`); // to trigger `nextWrite()`
    port.clear();
    if (db(ns).config.database.debugLocks) {
      ns.print(`Released db lock: ${pid}/${what}`);
    }
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
