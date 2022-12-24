import { NS } from '@ns';

import { Fmt } from '/fmt';

export async function main(ns: NS): Promise<void> {
  const nodes = ns.hacknet.numNodes();
  const limit = ns.getPlayer().money / 10 / nodes;
  const fmt = new Fmt(ns);

  while (ns.hacknet.getPurchaseNodeCost() < ns.getPlayer().money / 10) {
    ns.tprint(
      `[+] Purchasing new node for ${fmt.money(
        ns.hacknet.getPurchaseNodeCost()
      )}`
    );
    ns.hacknet.purchaseNode();
  }

  for (let node = 0; node < nodes; node++) {
    let upgrades = 0;
    while (ns.hacknet.getLevelUpgradeCost(node, upgrades + 1) <= limit) {
      upgrades += 1;
    }
    if (ns.hacknet.getLevelUpgradeCost(node, 1) === Number.POSITIVE_INFINITY) {
      ns.tprintf(`[-] Node ${node}: Already at max level`);
    } else if (upgrades === 0) {
      ns.tprintf(`[-] Node ${node}: Level upgrades too expensive`);
    } else {
      const cost = ns.hacknet.getLevelUpgradeCost(node, upgrades);
      ns.tprintf(
        `[+] Node ${node}: Upgrading level by ${upgrades} for ${fmt.money(
          cost
        )}`
      );
      ns.hacknet.upgradeLevel(node, upgrades);
    }

    upgrades = 0;
    while (ns.hacknet.getRamUpgradeCost(node, upgrades + 1) <= limit) {
      upgrades += 1;
    }
    if (ns.hacknet.getRamUpgradeCost(node, 1) === Number.POSITIVE_INFINITY) {
      ns.tprintf(`[-] Node ${node}: Already at max RAM`);
    } else if (upgrades === 0) {
      ns.tprintf(`[-] Node ${node}: RAM upgrades too expensive`);
    } else {
      const cost = ns.hacknet.getRamUpgradeCost(node, upgrades);
      ns.tprintf(
        `[+] Node ${node}: Upgrading RAM by ${upgrades} for ${fmt.money(cost)}`
      );
      ns.hacknet.upgradeRam(node, upgrades);
    }

    upgrades = 0;
    while (ns.hacknet.getCoreUpgradeCost(node, upgrades + 1) <= limit) {
      upgrades += 1;
    }
    if (ns.hacknet.getCoreUpgradeCost(node, 1) === Number.POSITIVE_INFINITY) {
      ns.tprintf(`[-] Node ${node}: Already at max cores`);
    } else if (upgrades === 0) {
      ns.tprintf(`[-] Node ${node}: Core upgrades too expensive`);
    } else {
      const cost = ns.hacknet.getCoreUpgradeCost(node, upgrades);
      ns.tprintf(
        `[+] Node ${node}: Upgrading cores by ${upgrades} for ${fmt.money(
          cost
        )}`
      );
      ns.hacknet.upgradeCore(node, upgrades);
    }
  }
}
