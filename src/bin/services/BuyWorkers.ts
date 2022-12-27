import { NS } from '@ns';

import { Fmt } from '/fmt';
import { Log } from '/log';
import { db } from '/services/Database/client';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "BuyWorkers");
  const fmt = new Fmt(ns);

  const config = async () => (await db(ns, log)).config.autobuyServers;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const thisConfig = await config();
    if (ns.getPlayer().money >= fmt.parseMoney(thisConfig.buyAt)) {
      await purchaseWorkers(fmt.parseMoney(thisConfig.reserveMoney));
    }
    await ns.sleep(thisConfig.intervalMs);
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
    purchased: string[];
    upgraded: string[];
  }

  function biggestAffordableServer(reserveMoney: number): number {
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

  async function purchaseWorkers(
    reserveMoney: number
  ): Promise<PurchaseResult> {
    log.debug("purchaseWorkers", { reserveMoney: fmt.money(reserveMoney) });

    const upgraded = upgrade(reserveMoney);
    const purchased = buyNew(reserveMoney);
    return { upgraded, purchased };
  }

  function upgrade(reserveMoney: number): string[] {
    const upgraded = [];
    const servers = ns.getPurchasedServers();
    servers.sort((a, b) => {
      return ns.getServerMaxRam(a) - ns.getServerMaxRam(b);
    });
    for (const server of servers) {
      const startRam = ns.getServerMaxRam(server);
      let ram;
      for (
        ram = startRam;
        ram < ns.getPurchasedServerMaxRam() &&
        ns.getPurchasedServerUpgradeCost(server, ram) <=
          ns.getPlayer().money - reserveMoney;
        ram *= 2
      ) {
        ns.upgradePurchasedServer(server, ram);
      }
      if (ram > startRam) {
        log.info("Upgraded server", { server, ram: fmt.memory(ram * 2) });
        upgraded.push(server);
      }
    }
    return upgraded;
  }

  function buyNew(reserveMoney: number): string[] {
    const newServers = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const ram = biggestAffordableServer(reserveMoney);
      if (ram === 0) {
        log.debug("No more affordable servers");
        return newServers;
      }
      if (ns.getPurchasedServerLimit() <= ns.getPurchasedServers().length) {
        log.debug("No more server slots");
        return newServers;
      }
      let index = 0;
      while (ns.serverExists(`worker-${index}`)) {
        index += 1;
      }
      const hostname = ns.purchaseServer(`worker-${index}`, ram);
      newServers.push(hostname);
      log.info("Purchased server", { hostname, ram: fmt.memory(ram) });
    }
  }
}
