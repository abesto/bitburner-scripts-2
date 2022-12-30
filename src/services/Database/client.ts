import { NS } from '@ns';

import { deepmerge } from 'deepmerge-ts';

import { DB, DB_PATH, DEFAULT_DB } from '/database';
import { Log } from '/log';
import { getProcessInfo } from '/procinfo';

import { withClient } from '../client_factory';
import { BaseClient } from '../common/BaseClient';
import { id } from '../common/Result';
import { DatabaseRequest, DatabaseResponse, LockData, SERVICE_ID, UnlockResult } from './types';

export class DatabaseClient extends BaseClient<
  typeof DatabaseRequest,
  typeof DatabaseResponse
> {
  protected override serviceId(): typeof SERVICE_ID {
    return SERVICE_ID;
  }
  protected override ResponseType(): typeof DatabaseResponse {
    return DatabaseResponse;
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

  protected async lock(): Promise<DB> {
    const resp: DatabaseResponse<"lock"> = await this.sendReceive(
      DatabaseRequest.lock(this.lockData()),
      {
        lock: id,
      }
    );
    if (resp.payload !== "ack") {
      return JSON.parse(resp.payload) as DB;
    } else {
      return await this.receive(
        {
          lockDeferred: (response) => JSON.parse(response.payload) as DB,
        },
        { timeout: Infinity }
      );
    }
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
    if (memdb === undefined) {
      throw new Error("Could not lock database, received undefined as the DB");
    }
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

export function dbSync(ns: NS, unsafe = false): DB {
  if (unsafe || ns.getHostname() === "home") {
    return deepmerge(DEFAULT_DB, JSON.parse(ns.read(DB_PATH)));
  } else {
    throw new Error("dbSync can only be called on home");
  }
}
