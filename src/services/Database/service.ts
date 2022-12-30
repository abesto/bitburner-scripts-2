import { NS } from '@ns';

import { match } from 'variant';

import { DB, DB_PATH } from '/database';
import { Log } from '/log';
import { PORTS } from '/ports';

import { BaseService, HandleRequestResult } from '../common/BaseService';
import { TimerManager } from '../TimerManager';
import { dbSync } from './client';
import {
    DatabaseRequest as Request, DatabaseResponse as Response, LockData, SERVICE_ID as DATABASE
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

export class DatabaseService extends BaseService<typeof Request, Response> {
  constructor(ns: NS, log?: Log) {
    super(ns, log);
    if (this.ns.getHostname() !== "home") {
      throw new Error("DatabaseService must be run on home");
    }
  }

  protected override RequestType(): typeof Request {
    return Request;
  }
  protected override registerTimers(timers: TimerManager): void {
    timers.setInterval(() => this.breakStaleLock(), 1000);
  }
  protected override serviceId(): keyof typeof PORTS {
    return DATABASE;
  }
  protected override handleRequest(
    request: Request | null
  ): HandleRequestResult {
    if (request !== null) {
      match(request, {
        read: (request) => this.read(request),
        lock: (request) => this.lock(request),
        unlock: (request) => this.unlock(request),
        writeAndUnlock: (request) => this.writeAndUnlock(request),
        status: (request) => this.status(request),
      });
    }
    return "continue";
  }

  status(request: Request<"status">): void {
    const memdb = this.loadFromDisk();
    this.respond(
      request.responsePort,
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
    return dbSync(this.ns, true);
  }

  private saveToDisk(db: DB): void {
    this.ns.write(DB_PATH, JSON.stringify(db, null, 2), "w");
  }

  read(request: Request<"read">): void {
    this.respond(
      request.responsePort,
      Response.read({ content: JSON.stringify(this.loadFromDisk()) })
    );
  }

  lock(request: Request<"lock">): void {
    const memdb = this.loadFromDisk();
    const responsePort = request.lockData.responsePort;

    if (memdb.meta.currentLock === null) {
      memdb.meta.currentLock = request.lockData;
      this.saveToDisk(memdb);
      this.respond(responsePort, Response.lock(JSON.stringify(memdb)));
    } else {
      memdb.meta.lockQueue.push(request.lockData);
      this.respond(responsePort, Response.lock("ack"));
    }
  }

  private doNextLock(memdb: DB, nextLock: LockData): void {
    memdb.meta.currentLock = nextLock;
    this.respond(
      nextLock.responsePort,
      Response.lockDeferred(JSON.stringify(memdb))
    );
  }

  unlock(request: Request<"unlock">, newDb: DB | null = null): void {
    const memdb = newDb || this.loadFromDisk();

    if (memdb.meta.currentLock === null) {
      this.log.warn(
        "Unlock request received but no lock is held",
        request.lockData
      );
      return this.respond(
        request.lockData.responsePort,
        Response.unlock({ result: "not-locked" })
      );
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
      return this.respond(
        request.lockData.responsePort,
        Response.unlock({ result: "locked-by-other" })
      );
    }

    memdb.meta.currentLock = null;
    this.respond(
      request.lockData.responsePort,
      Response.unlock({ result: "ok" })
    );

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
