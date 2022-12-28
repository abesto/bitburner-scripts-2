import { NS } from '@ns';

import { match } from 'variant';

import { DB, DB_PATH, DEFAULT_DB } from '/database';
import { Fmt } from '/fmt';
import { Log } from '/log';
import { PORTS } from '/ports';

import { ClientPort } from '../common/ClientPort';
import { ServerPort } from '../common/ServerPort';
import { dbSync } from './client';
import {
    DatabaseRequest as Request, DatabaseResponse as Response, LockData, SERVICE_ID as DATABASE,
    toDatabaseRequest
} from './types';

function arrayEquals(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

export class DatabaseService {
  private readonly fmt: Fmt;
  private readonly log: Log;
  private memdb: DB = DEFAULT_DB;

  constructor(private readonly ns: NS) {
    if (this.ns.getHostname() !== "home") {
      throw new Error("DatabaseService must be run on home");
    }
    this.fmt = new Fmt(ns);
    this.log = new Log(ns, "Database");
  }

  async listen(): Promise<void> {
    const listenPort = new ServerPort<Request>(
      this.ns,
      this.log,
      PORTS[DATABASE],
      toDatabaseRequest
    );
    this.log.info("Listening", {
      port: listenPort.portNumber,
    });

    const buffer = [];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.breakStaleLock();
      buffer.push(...listenPort.drain());
      const request =
        buffer.shift() ??
        (await listenPort.read({
          timeout: Infinity,
          throwOnTimeout: false,
        }));
      if (request === null) {
        continue;
      }

      match(request, {
        read: (request) => this.read(request),
        lock: (request) => this.lock(request),
        unlock: (request) => this.unlock(request),
        writeAndUnlock: (request) => this.writeAndUnlock(request),
        status: (request) => this.status(request),
      });
    }
  }

  status(request: Request<"status">): void {
    const clientPort = new ClientPort<Response>(
      this.ns,
      this.log,
      request.responsePort
    );
    const memdb = this.loadFromDisk();
    clientPort.writeSync(
      Response.status({
        currentLock: memdb.meta.currentLock,
        lockQueue: memdb.meta.lockQueue,
      })
    );
  }

  private breakStaleLock(): void {
    const memdb = this.loadFromDisk();
    if (memdb.meta.currentLock === null) {
      return;
    }
    const lock = memdb.meta.currentLock;
    const process = this.ns.getRunningScript(lock.pid);
    if (
      process === null ||
      process.filename !== lock.script ||
      !arrayEquals(process.args, lock.args) ||
      process.server !== lock.hostname
    ) {
      this.log.twarn("Breaking stale lock", {
        lock,
        process,
      });
      memdb.meta.currentLock = null;
      const nextLock = memdb.meta.lockQueue.shift();
      if (nextLock !== undefined) {
        this.doNextLock(memdb, nextLock);
      }
      this.saveToDisk(memdb);
    }
  }

  private loadFromDisk(): DB {
    return dbSync(this.ns);
  }

  private saveToDisk(db: DB): void {
    this.ns.write(DB_PATH, JSON.stringify(db, null, 2), "w");
  }

  read(request: Request<"read">): void {
    const response = Response.read({
      content: JSON.stringify(this.loadFromDisk()),
    });
    const client = new ClientPort<Response>(
      this.ns,
      this.log,
      request.responsePort
    );
    client.writeSync(response);
  }

  lock(request: Request<"lock">): void {
    const memdb = this.loadFromDisk();
    const client = new ClientPort<Response>(
      this.ns,
      this.log,
      request.lockData.responsePort
    );

    if (memdb.meta.currentLock === null) {
      memdb.meta.currentLock = request.lockData;
      this.saveToDisk(memdb);
      client.writeSync(Response.lock(JSON.stringify(memdb)));
    } else {
      memdb.meta.lockQueue.push(request.lockData);
      client.writeSync(Response.lock("ack"));
    }
  }

  private doNextLock(memdb: DB, nextLock: LockData): void {
    memdb.meta.currentLock = nextLock;
    const newClient = new ClientPort<Response>(
      this.ns,
      this.log,
      nextLock.responsePort
    );
    newClient.writeSync(Response.lockDeferred(JSON.stringify(memdb)));
  }

  unlock(request: Request<"unlock">, newDb: DB | null = null): void {
    const memdb = newDb || this.loadFromDisk();

    const client = new ClientPort<Response>(
      this.ns,
      this.log,
      request.lockData.responsePort
    );
    if (memdb.meta.currentLock === null) {
      this.log.warn(
        "Unlock request received but no lock is held",
        request.lockData
      );
      client.writeSync(Response.unlock({ result: "not-locked" }));
      return;
    }

    if (
      memdb.meta.currentLock.pid !== request.lockData.pid ||
      !arrayEquals(memdb.meta.currentLock.args, request.lockData.args) ||
      memdb.meta.currentLock.script !== request.lockData.script ||
      memdb.meta.currentLock.hostname !== request.lockData.hostname ||
      memdb.meta.currentLock.responsePort !== request.lockData.responsePort
    ) {
      this.log.terror(
        "Unlock request received but lock is held by another script",
        {
          requester: request.lockData,
          owner: memdb.meta.currentLock,
        }
      );
      client.writeSync(Response.unlock({ result: "locked-by-other" }));
      return;
    }

    memdb.meta.currentLock = null;
    client.writeSync(Response.unlock({ result: "ok" }));

    const nextLock = memdb.meta.lockQueue.shift();
    if (nextLock !== undefined) {
      this.doNextLock(memdb, nextLock);
    }

    this.saveToDisk(memdb);
  }

  writeAndUnlock(request: Request<"writeAndUnlock">): void {
    this.unlock(Request.unlock(request), JSON.parse(request.content));
  }
}
