import { DB } from '/database';
import { PORTS } from '/ports';
import { getProcessInfo } from '/procinfo';
import { BaseClient } from '../common';
import {
    DatabaseRequest, DatabaseResponse, LockData, SERVICE_ID, toDatabaseResponse, UnlockResult
} from './types';

export class DatabaseClient extends BaseClient<
  DatabaseRequest,
  DatabaseResponse
> {
  parseResponse = toDatabaseResponse;
  requestPortNumber = () => PORTS[SERVICE_ID];

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
