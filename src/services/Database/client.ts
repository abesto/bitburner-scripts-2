import { NS } from '@ns';

import { deepmerge } from 'deepmerge-ts';

import { DB, DB_PATH, DEFAULT_DB } from '/database';
import { Log } from '/log';
import { PORTS } from '/ports';
import { getProcessInfo } from '/procinfo';

import { withClient } from '../client_factory';
import { BaseClient } from '../common/BaseClient';
import { PortRegistryClient } from '../PortRegistry/client';
import {
    DatabaseRequest, DatabaseResponse, LockData, SERVICE_ID, toDatabaseResponse, UnlockResult
} from './types';

export class DatabaseClient extends BaseClient<
  DatabaseRequest,
  DatabaseResponse
> {
  requestPortNumber(): number {
    return PORTS[SERVICE_ID];
  }

  parseResponse(response: unknown): DatabaseResponse | null {
    return toDatabaseResponse(response);
  }

  read(): Promise<DB> {
    return this.sendReceive(DatabaseRequest.read(this.rp()), {
      read: (response) => JSON.parse(response.content) as DB,
    });
  }

  private lockData(): { lockData: LockData } {
    const procinfo = getProcessInfo(this.ns);
    return {
      lockData: {
        hostname: this.ns.getHostname(),
        script: procinfo.filename,
        args: procinfo.args,
        pid: procinfo.pid,
        ...this.rp(),
      },
    };
  }

  lock(): Promise<DB> {
    return this.sendReceive(
      DatabaseRequest.lock(this.lockData()),
      {
        lock: (response) => JSON.parse(response.content) as DB,
      },
      { readTimeout: null }
    );
  }

  unlock(): Promise<UnlockResult> {
    return this.sendReceive(DatabaseRequest.unlock(this.lockData()), {
      unlock: (response) => response.result,
    });
  }

  writeAndUnlock(content: DB): Promise<UnlockResult> {
    return this.sendReceive(
      DatabaseRequest.writeAndUnlock({
        content: JSON.stringify(content),
        ...this.lockData(),
      }),
      {
        unlock: (response) => response.result,
      }
    );
  }
}

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
    contents = JSON.parse(ns.read(DB_PATH));
  } else {
    contents = await withClient(
      DatabaseClient,
      ns,
      log,
      async (client) => await client.read()
    );
  }
  return deepmerge(DEFAULT_DB, contents);
}
