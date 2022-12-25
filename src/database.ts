import { NS } from '@ns';

import { deepmerge } from 'deepmerge-ts';
import { Log } from './log';
import { DatabaseClient } from './services/Database/client';
import { LockData } from './services/Database/types';
import { PortRegistryClient } from './services/PortRegistry/client';
import { Job, ServiceState } from './services/Scheduler/types';

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
    hwgw: {
      moneyThreshold: number;
      spacing: number;
    };
    scheduler: {
      reserveHomeRam: number;
    };
    autobuyServers: {
      reserveMoney: string;
      buyAt: string;
      intervalMs: number;
    };
  };
  scheduler: SchedulerDB;
  meta: MetaDB;
};

export type SchedulerDB = {
  jobs: { [jobId: string]: Job };
  services: {
    [name: string]: ServiceState;
  };
};

export type MetaDB = {
  lockQueue: LockData[];
  currentLock: LockData | null;
};

export const DB_PATH = "/db.json.txt";

export const DEFAULT_DB: DB = {
  config: {
    database: {
      debugLocks: false,
    },
    simpleHack: {
      moneyThreshold: 0.75,
      securityThreshold: 5,
    },
    hwgw: {
      moneyThreshold: 0.5,
      spacing: 500,
    },
    scheduler: {
      reserveHomeRam: 8,
    },
    autobuyServers: {
      reserveMoney: "$10m",
      buyAt: "30m",
      intervalMs: 5000,
    },
  },
  scheduler: {
    jobs: {},
    services: {},
  },
  meta: { lockQueue: [], currentLock: null },
};

export async function dbLock(
  ns: NS,
  log: Log,
  fn: (db: DB) => Promise<DB | undefined>
): Promise<void> {
  const portRegistryClient = new PortRegistryClient(ns, log);
  const responsePort = await portRegistryClient.reservePort();
  const databaseClient = new DatabaseClient(ns, log, responsePort);
  const memdb = await databaseClient.lock();

  let newDb;
  try {
    newDb = await fn(memdb);
  } finally {
    if (newDb !== undefined) {
      await databaseClient.writeAndUnlock(newDb);
    } else {
      await databaseClient.unlock();
    }
    await portRegistryClient.releasePort(responsePort);
  }
}

export async function db(ns: NS, log: Log, forceLocal = false): Promise<DB> {
  if (!ns.fileExists(DB_PATH)) {
    ns.write(DB_PATH, "{}", "w");
  }

  let contents;
  if (forceLocal || ns.getHostname() === "home") {
    contents = JSON.parse(ns.read("/db.json"));
  } else {
    const portRegistryClient = new PortRegistryClient(ns, log);
    const responsePort = await portRegistryClient.reservePort();
    const databaseClient = new DatabaseClient(ns, log, responsePort);
    contents = await databaseClient.read();
  }
  return deepmerge(DEFAULT_DB, contents);
}
