import { NS } from '@ns';

import { deepmerge } from 'deepmerge-ts';

import { DB, DB_PATH, DEFAULT_DB } from '/database';
import { Log } from '/log';
import { PORTS } from '/ports';
import { getProcessInfo } from '/procinfo';

import { withClient } from '../client_factory';
import { BaseClient } from '../common/BaseClient';
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

  protected lock(): Promise<DB> {
    return this.sendReceive(
      DatabaseRequest.lock(this.lockData()),
      {
        lock: (response) => JSON.parse(response.content) as DB,
      },
      { readTimeout: Infinity }
    );
  }

  protected unlock(): Promise<UnlockResult> {
    return this.sendReceive(DatabaseRequest.unlock(this.lockData()), {
      unlock: (response) => response.result,
    });
  }

  protected writeAndUnlock(content: DB): Promise<UnlockResult> {
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

  status(): Promise<DatabaseResponse<"status">> {
    return this.sendReceive(DatabaseRequest.status(this.rp()), {
      status: (response) => response,
    });
  }

  async withLock(fn: (db: DB) => Promise<DB | undefined>): Promise<void> {
    const memdb = await this.lock();
    let newDb;
    try {
      newDb = await fn(memdb);
    } finally {
      if (newDb !== undefined) {
        await this.writeAndUnlock(newDb);
      } else {
        await this.unlock();
      }
    }
  }
}

export async function dbLock(
  ns: NS,
  log: Log,
  fn: (db: DB) => Promise<DB | undefined>
): Promise<void> {
  await withClient(DatabaseClient, ns, log, async (client) => {
    await client.withLock(fn);
  });
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
