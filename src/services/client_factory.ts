import { NS } from '/../NetscriptDefinitions';
import { Log } from '/log';

import { BaseClient } from './common/BaseClient';
import { PortRegistryClient } from './PortRegistry/client';

export async function reservingNewPort<
  Request extends { type: string },
  Response extends { type: string },
  C extends BaseClient<Request, Response>
>(
  cls: {
    new (
      ns: NS,
      log: Log,
      responsePortNumber: number,
      portRegistryClient?: PortRegistryClient
    ): C;
  },
  ns: NS,
  log: Log
): Promise<C> {
  const portRegistryClient = new PortRegistryClient(ns, log);
  const responsePortNumber = await portRegistryClient.reservePort();
  return new cls(ns, log, responsePortNumber, portRegistryClient);
}

export async function withClient<
  Request extends { type: string },
  Response extends { type: string },
  C extends BaseClient<Request, Response>,
  R
>(
  cls: {
    new (
      ns: NS,
      log: Log,
      responsePortNumber: number,
      portRegistryClient?: PortRegistryClient
    ): C;
  },
  ns: NS,
  log: Log,
  callback: (client: C) => Promise<R>
): Promise<R> {
  const client = await reservingNewPort(cls, ns, log);
  let retval;
  try {
    retval = await callback(client);
  } finally {
    await client.release();
  }
  return retval;
}
