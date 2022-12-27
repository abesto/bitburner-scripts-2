import { LockData } from './services/Database/types';
import { Job, ServiceState } from './services/Scheduler/types';

export type DB = {
  config: {
    database: {
      debugLocks: boolean;
    };
    share: {
      percentage: number;
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
      maxDepth: number;
      batchViz: {
        centerBias: number;
      };
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
    share: {
      percentage: 0.75,
    },
    simpleHack: {
      moneyThreshold: 0.75,
      securityThreshold: 5,
    },
    hwgw: {
      moneyThreshold: 0.5,
      spacing: 500,
      maxDepth: 0,
      batchViz: {
        centerBias: 0.5,
      },
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
