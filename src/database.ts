import { NS } from "@ns";
import { deepmerge } from "deepmerge-ts";
import { dbLockPort } from "./ports";
import { Job, ServiceState } from "./services/Scheduler/types";

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
};

export type SchedulerDB = {
  jobs: { [jobId: string]: Job };
  services: {
    [name: string]: ServiceState;
  };
};

const DB_PATH = "/db.json.txt";

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
};

type Lock = {
  hostname: string;
  pid: number;
  status: "lock" | "unlock";
};

export async function dbLock(
  ns: NS,
  what: string,
  fn: (db: DB) => Promise<DB | undefined>
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const pid = ns.getRunningScript()!.pid;
  const port = dbLockPort(ns);

  while (!port.empty()) {
    const { hostname, pid: owner } = JSON.parse(port.peek() as string) as Lock;
    if (ns.ps(hostname).find((p) => p.pid === owner) === undefined) {
      ns.print(`Found stale lock: ${hostname}/${owner}`);
      port.clear();
    } else {
      ns.print(`Waiting for db lock: ${pid}/${what}`);
      await port.nextWrite();
    }
  }
  port.write(
    JSON.stringify({ hostname: ns.getHostname(), pid, status: "lock" })
  );
  if ((await db(ns)).config.database.debugLocks) {
    ns.print(`Got db lock: ${pid}/${what}`);
  }

  let retval;
  try {
    const newDb = await fn(await db(ns));
    if (newDb !== undefined) {
      saveDb(ns, newDb);
    }
  } finally {
    port.write(
      JSON.stringify({ hostname: ns.getHostname(), pid, status: "unlock" })
    );
    port.clear();
    if ((await db(ns)).config.database.debugLocks) {
      ns.print(`Released db lock: ${pid}/${what}`);
    }
  }

  return retval;
}

export async function db(ns: NS): Promise<DB> {
  const hostname = ns.getHostname();
  if (hostname !== "home" && ns.fileExists(DB_PATH, "home")) {
    await ns.sleep(0);
    if (!ns.scp(DB_PATH, hostname, "home")) {
      throw new Error(`Failed to scp DB to ${hostname}`);
    }
    await ns.sleep(0);
  }

  if (!ns.fileExists(DB_PATH)) {
    ns.write(DB_PATH, "{}", "w");
  }

  const contents = JSON.parse(ns.read("/db.json"));
  return deepmerge(DEFAULT_DB, contents);
}

function saveDb(ns: NS, db: DB): void {
  ns.write(DB_PATH, JSON.stringify(db, null, 4), "w");

  if (ns.getHostname() !== "home") {
    if (!ns.scp(DB_PATH, "home")) {
      throw new Error("Failed to scp DB to home");
    }
  }
}
