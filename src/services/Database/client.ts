import { NS } from '@ns';

import { DB } from '/database';
import { Log } from '/log';
import { PORTS } from '/ports';
import { getProcessInfo } from '/procinfo';
import { Handler, match, VariantsOfUnion } from 'variant';
import { ClientPort, ServerPort } from '../common';
import {
    DatabaseRequest, DatabaseResponse, LockData, SERVICE_ID, toDatabaseResponse, UnlockResult
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
    const request = DatabaseRequest.read({
      responsePort: this.responsePortNumber,
    });
    await this.databasePort.write(request);
    const response = await this.responsePort.read();
    return this.handleResponse(response, {
      read: (response) => JSON.parse(response.content) as DB,
    });
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
    const request = DatabaseRequest.lock({ lockData: this.lockData() });
    await this.databasePort.write(request);
    const response = await this.responsePort.read(null);
    return this.handleResponse(response, {
      lock: (response) => JSON.parse(response.content) as DB,
    });
  }

  handleResponse<
    Response extends { type: string },
    Ret,
    M extends Partial<Handler<VariantsOfUnion<Response, "type">, Ret>>
  >(result: Response | null, matcher: M): Ret {
    if (result === null) {
      throw new Error("Invalid response");
    }
    return match(result, matcher, () => {
      throw new Error(`Invalid response: ${JSON.stringify(result)}`);
    });
  }

  async unlock(): Promise<UnlockResult> {
    const request = DatabaseRequest.unlock({ lockData: this.lockData() });
    await this.databasePort.write(request);
    const response = await this.responsePort.read();
    return this.handleResponse(response, {
      unlock: (payload) => payload.result,
    });
  }

  async writeAndUnlock(content: DB): Promise<UnlockResult> {
    const request = DatabaseRequest.writeAndUnlock({
      content: JSON.stringify(content),
      lockData: this.lockData(),
    });
    await this.databasePort.write(request);
    const response = await this.responsePort.read();
    return this.handleResponse(response, {
      unlock: (payload) => payload.result,
    });
  }
}
