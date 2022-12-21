import { NS } from "@ns";
import { deepmerge } from "deepmerge-ts";

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

export function db(ns: NS): DB {
  if (!ns.fileExists(DB_PATH)) {
    ns.write(DB_PATH, "{}", "w");
  }
  const contents = JSON.parse(ns.read("/db.json"));
  return deepmerge(DEFAULT_DB, contents);
}

export function saveDb(ns: NS, db: DB): void {
  ns.write(DB_PATH, JSON.stringify(db, null, 4), "w");
}
