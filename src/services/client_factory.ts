import { NS } from '/../NetscriptDefinitions';
import { Log } from '/log';

import { BaseClient } from './common/BaseClient';
import { PortRegistryClient } from './PortRegistry/client';

export async function withClient<C, R>(
  cls: {
    new (
      ns: NS,
      log: Log,
      responsePortNumber: number,
      portRegistryClient?: PortRegistryClient
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ): C extends BaseClient<infer Request, infer Response> ? C : never;
  },
  ns: NS,
  log: Log,
  callback: (client: C) => Promise<R>
): Promise<R> {
  const portRegistryClient = new PortRegistryClient(ns, log);
  const responsePortNumber = await portRegistryClient.reservePort();
  const client = new cls(ns, log, responsePortNumber, portRegistryClient);
  let retval;
  try {
    retval = await callback(client);
  } finally {
    await client.release();
  }
  return retval;
}
