import { NS } from '@ns';

import { Fmt } from '/fmt';
import { Log } from '/log';
import { db } from '/services/Database/client';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "BuyWorkers");
  const fmt = new Fmt(ns);

  const config = async () => (await db(ns, log)).config.autobuyServers;
  const reserveMoney = async () =>
    fmt.parseMoney((await config()).reserveMoney);
  const buyAt = async () => fmt.parseMoney((await config()).buyAt);
  const interval = async () => (await config()).intervalMs;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (ns.getPlayer().money >= (await buyAt())) {
      await purchaseWorkers();
    }
    await ns.sleep(await interval());
  }

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
    log.info("Deleting weakest server", {
      server,
      ram: fmt.memory(ns.getServerMaxRam(server)),
    });
    for (const p of ns.ps(server)) {
      ns.kill(p.filename, server, ...p.args);
    }
    if (!ns.deleteServer(server)) {
      log.error("Failed to delete server", { server });
    }
    return server;
  }

  interface PurchaseResult {
    deleted: string[];
    purchased: string[];
  }

  async function biggestAffordableServer(): Promise<number> {
    let ram = 8;
    const money = ns.getPlayer().money - (await reserveMoney());
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
      log.info("Purchased server", { hostname, ram: fmt.memory(ram) });
    }

    return result;
  }
}
