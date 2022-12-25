import { NS } from '@ns';

import { Fmt } from '/fmt';
import { Log } from '/log';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "buy-server");
  const fmt = new Fmt(ns);
  await purchaseWorkers();

  async function deleteWeakestWorker(keep: number): Promise<string | null> {
    const server = ns
      .getPurchasedServers()
      .filter((h) => h.startsWith("worker-"))
      .reduce((a, b) => {
        if (ns.getServerMaxRam(a) > ns.getServerMaxRam(b)) {
          return b;
        }
        return a;
      });
    if (ns.getServerMaxRam(server) >= keep) {
      //ns.print(`Not deleting weakest worker, it's too big: ${server} (${ns.getServerMaxRam(server)}GB > ${keep}GB)`);
      return null;
    }
    for (const p of ns.ps(server)) {
      ns.kill(p.filename, server, ...p.args);
    }
    if (!ns.deleteServer(server)) {
      log.terror("Failed to delete server", { server });
    }
    return server;
  }

  interface PurchaseResult {
    deleted: string[];
    purchased: string[];
  }

  async function biggestAffordableServer(): Promise<number> {
    let ram = 8;
    const money = ns.getPlayer().money;
    if (ns.getPurchasedServerCost(ram) > money) {
      return 0;
    }
    while (ns.getPurchasedServerCost(ram * 2) <= money) {
      ram = ram * 2;
    }
    return ram;
  }

  async function purchaseWorkers(): Promise<PurchaseResult> {
    const result: PurchaseResult = { deleted: [], purchased: [] };

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const ram = await biggestAffordableServer();
      if (ram === 0) {
        break;
      }
      if (ns.getPurchasedServerLimit() <= ns.getPurchasedServers().length) {
        const deleted = await deleteWeakestWorker(ram);
        if (deleted === null) {
          break;
        }
        result.deleted.push(deleted);
      }
      let index = 0;
      while (ns.serverExists(`worker-${index}`)) {
        index += 1;
      }
      const hostname = ns.purchaseServer(`worker-${index}`, ram);
      result.purchased.push(hostname);
      log.tinfo("Purchased server", { hostname, ram: fmt.memory(ram) });
    }

    return result;
  }
}
