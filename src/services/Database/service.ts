import { NS } from '/../NetscriptDefinitions';
import { DB, db, DB_PATH } from '/database';
import { Fmt } from '/fmt';
import { Log } from '/log';
import { PORTS } from '/ports';
import { matchI } from 'ts-adt';
import { ClientPort, ServerPort } from '../common';
import {
    DatabaseRequest, DatabaseRequest$Lock, DatabaseRequest$Unlock, DatabaseRequest$WriteAndUnlock,
    DatabaseResponse, LockData, lockResponse, readResponse, SERVICE_ID as DATABASE,
    toDatabaseRequest, unlockResponseError, unlockResponseOk
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

  constructor(private readonly ns: NS) {
    if (this.ns.getHostname() !== "home") {
      throw new Error("DatabaseService must be run on home");
    }
    this.fmt = new Fmt(ns);
    this.log = new Log(ns, "Database");
  }

  async listen(): Promise<void> {
    const listenPort = new ServerPort<DatabaseRequest>(
      this.ns,
      this.log,
      PORTS[DATABASE],
      toDatabaseRequest
    );
    this.log.info("Listening", {
      port: listenPort.portNumber,
    });

    // eslint-disable-next-line no-constant-condition
    while (true) {
      await this.breakStaleLock();
      if (listenPort.empty()) {
        await Promise.any([listenPort.nextWrite(), this.ns.asleep(5000)]);
        continue;
      }
      const request = await listenPort.read(null);
      if (request === null) {
        continue;
      }

      await matchI(request)({
        read: (request) => this.read(request),
        lock: (request) => this.lock(request),
        unlock: (request) => this.unlock(request),
        writeAndUnlock: (request) => this.writeAndUnlock(request),
      });
    }
  }

  private async breakStaleLock(): Promise<void> {
    const memdb = await this.loadFromDisk();
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
        await this.doNextLock(memdb, nextLock);
      }
      await this.saveToDisk(memdb);
    }
  }

  private async loadFromDisk(): Promise<DB> {
    return await db(this.ns, this.log, true);
  }

  private async saveToDisk(db: DB): Promise<void> {
    this.ns.write(DB_PATH, JSON.stringify(db, null, 2), "w");
  }

  async read(request: { responsePort: number }): Promise<void> {
    const response = readResponse(JSON.stringify(await this.loadFromDisk()));
    const client = new ClientPort<DatabaseResponse>(
      this.ns,
      this.log,
      request.responsePort
    );
    await client.write(response);
  }

  async lock(request: DatabaseRequest$Lock): Promise<void> {
    const memdb = await this.loadFromDisk();

    if (memdb.meta.currentLock === null) {
      memdb.meta.currentLock = request.lockData;
      await this.saveToDisk(memdb);
      const client = new ClientPort<DatabaseResponse>(
        this.ns,
        this.log,
        request.lockData.responsePort
      );
      const response = lockResponse(JSON.stringify(memdb));
      await client.write(response);
    } else {
      memdb.meta.lockQueue.push(request.lockData);
    }
  }

  private async doNextLock(memdb: DB, nextLock: LockData): Promise<void> {
    memdb.meta.currentLock = nextLock;
    const newClient = new ClientPort<DatabaseResponse>(
      this.ns,
      this.log,
      nextLock.responsePort
    );
    return await newClient.write(lockResponse(JSON.stringify(memdb)));
  }

  async unlock(
    request: DatabaseRequest$Unlock,
    newDb: DB | null = null
  ): Promise<void> {
    const memdb = newDb || (await this.loadFromDisk());

    const client = new ClientPort<DatabaseResponse>(
      this.ns,
      this.log,
      request.lockData.responsePort
    );
    if (memdb.meta.currentLock === null) {
      this.log.warn(
        "Unlock request received but no lock is held",
        request.lockData
      );
      return await client.write(unlockResponseError("not-locked"));
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
      return await client.write(unlockResponseError("locked-by-other"));
    }

    memdb.meta.currentLock = null;
    await client.write(unlockResponseOk());

    const nextLock = memdb.meta.lockQueue.shift();
    if (nextLock !== undefined) {
      await this.doNextLock(memdb, nextLock);
    }

    await this.saveToDisk(memdb);
  }

  async writeAndUnlock(request: DatabaseRequest$WriteAndUnlock): Promise<void> {
    await this.unlock(request, JSON.parse(request.content));
  }
}