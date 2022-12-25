import { NS } from '@ns';

import { DB } from '/database';
import { Log } from '/log';
import { PORTS } from '/ports';
import { getProcessInfo } from '/procinfo';
import { refinement } from 'ts-adt';
import { ClientPort, ServerPort } from '../common';
import {
    DatabaseRequest, DatabaseResponse, DatabaseResponse$Unlock, LockData, lockRequest, readRequest,
    SERVICE_ID, toDatabaseResponse, unlockRequest, UnlockResult, writeAndUnlockRequest
} from './types';

export class DatabaseClient {
  private readonly responsePort: ServerPort<DatabaseResponse>;
  private readonly databasePort: ClientPort<DatabaseRequest>;

  constructor(
    private readonly ns: NS,
    log: Log,
    private readonly responsePortNumber: number
  ) {
    this.responsePort = new ServerPort(
      ns,
      log,
      responsePortNumber,
      toDatabaseResponse
    );
    this.databasePort = new ClientPort(ns, log, PORTS[SERVICE_ID]);
  }

  async read(): Promise<DB> {
    const request = readRequest(this.responsePortNumber);
    await this.databasePort.write(request);
    const response = await this.responsePort.read();
    // TODO this part should be factored out, but the typing is tricky.
    if (response === null) {
      throw new Error("Invalid response");
    }
    if (refinement("read")(response)) {
      return JSON.parse(response.content) as DB;
    } else {
      throw new Error(`Invalid response: ${JSON.stringify(response)}`);
    }
  }

  lockData(): LockData {
    const procinfo = getProcessInfo(this.ns);
    return {
      hostname: this.ns.getHostname(),
      script: procinfo.filename,
      args: procinfo.args,
      pid: procinfo.pid,
      responsePort: this.responsePortNumber,
    };
  }

  async lock(): Promise<DB> {
    const request = lockRequest(this.lockData());
    await this.databasePort.write(request);
    const response = await this.responsePort.read(null);
    // TODO this part should be factored out, but the typing is tricky.
    if (response === null) {
      throw new Error("Invalid response");
    }
    if (refinement("lock")(response)) {
      return JSON.parse(response.content) as DB;
    } else {
      throw new Error(`Invalid response: ${JSON.stringify(response)}`);
    }
  }

  async unlock(): Promise<UnlockResult> {
    const request = unlockRequest(this.lockData());
    await this.databasePort.write(request);
    const response = await this.responsePort.read();
    // TODO this part should be factored out, but the typing is tricky.
    if (response === null) {
      throw new Error("Invalid response");
    }
    if (refinement("unlock")(response)) {
      return response.payload;
    } else {
      throw new Error(`Invalid response: ${JSON.stringify(response)}`);
    }
  }

  async writeAndUnlock(content: DB): Promise<UnlockResult> {
    const request = writeAndUnlockRequest(
      JSON.stringify(content),
      this.lockData()
    );
    await this.databasePort.write(request);
    const response = await this.responsePort.read();
    // TODO this part should be factored out, but the typing is tricky.
    if (response === null) {
      throw new Error("Invalid response");
    }
    if (refinement("unlock")(response)) {
      return response.payload;
    } else {
      throw new Error(`Invalid response: ${JSON.stringify(response)}`);
    }
  }
}
