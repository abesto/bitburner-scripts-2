import { NS } from "@ns";
import { db } from "/database";
import { Fmt } from "/fmt";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");
  const fmt = new Fmt(ns);
  const config = (await db(ns)).config.autobuyServers;
  const reserveMoney = fmt.parseMoney(config.reserveMoney);

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
    ns.print(
      `Deleting weakest server: ${server} (${ns.getServerMaxRam(server)}GB)`
    );
    for (const p of ns.ps(server)) {
      ns.kill(p.pid);
    }
    if (!ns.deleteServer(server)) {
      throw new Error(`Failed to delete server ${server}`);
    }
    return server;
  }

  interface PurchaseResult {
    deleted: string[];
    purchased: string[];
  }

  function biggestAffordableServer(): number {
    let ram = 8;
    const money = ns.getPlayer().money - reserveMoney;
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
      const ram = biggestAffordableServer();
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
      ns.print(`Purchased ${hostname} with ${ram}GB RAM`);
    }

    return result;
  }
}
