/* eslint-disable no-constant-condition */
import { NS } from "@ns";

import { Fmt } from "/fmt";
import { getProcessInfo } from "/procinfo";

export async function main(ns: NS): Promise<void> {
  const fmt = new Fmt(ns);
  ns.disableLog("asleep");

  function score(symbol: string): number {
    return ns.stock.getForecast(symbol);
  }

  function findBest(): string | null {
    let target = null;

    for (const symbol of ns.stock.getSymbols()) {
      if (ns.stock.getMaxShares(symbol) === ns.stock.getPosition(symbol)[0]) {
        //print(`Already maxed out on ${target}, skipping`);
        continue;
      }
      if (target === null || score(target) < score(symbol)) {
        target = symbol;
      }
    }

    return target;
  }

  async function buyFor(
    money: number,
    print: (msg: string) => void
  ): Promise<void> {
    let spent = 0;

    let n = 0;
    while (spent < money && n++ < 100) {
      const target = findBest();
      if (target === null) {
        print(
          "We already bought all the good stuff, top some up if you want manually"
        );
        break;
      }

      const stonks =
        Math.min(
          Math.floor((money - spent) / ns.stock.getBidPrice(target)),
          ns.stock.getMaxShares(target)
        ) - ns.stock.getPosition(target)[0];
      if (stonks <= 0) {
        print("Can't buy more o.0");
        break;
      }

      if (score(target) < 0.6) {
        print(
          `Best stock to buy: ${target} has score ${fmt.float(
            score(target)
          )}. That's < 0.6, not buying`
        );
        break;
      }

      const buyin = stonks * ns.stock.getBidPrice(target);
      print(
        `Best stonk to buy: ${target} has score ${fmt.float(
          score(target)
        )}. Buying ${stonks} for ${fmt.money(buyin)}`
      );
      if (ns.stock.buyStock(target, stonks) > 0) {
        spent += buyin;
        ns.print(`Bought ${stonks} ${target} for ${fmt.money(buyin)}`);
        ns.toast(`Bought ${stonks} ${target} for ${fmt.money(buyin)}`);
      }
    }

    if (!ns.isRunning(getProcessInfo(ns).filename, ns.getHostname(), "watch")) {
      print("Starting stock watcher");
      await ns.run(getProcessInfo(ns).filename, 1, "watch");
    }
  }

  if (ns.args[0] === "buy") {
    await buyFor(fmt.parseMoney(ns.args[1] as string), ns.tprint.bind(ns));
  } else if (ns.args[0] === "autobuy") {
    const downto = fmt.parseMoney(ns.args[1] as string);
    while (true) {
      const available = ns.getPlayer().money - downto;
      // TODO make this configurable. Maybe "downto" as well.
      if (available > 100000) {
        await buyFor(available, ns.print.bind(ns));
      }
      await ns.asleep(5000);
    }
  } else if (ns.args[0] === "watch") {
    const lastGains: { [symbol: string]: number } = {};
    let lastTotal = 0;

    while (true) {
      for (const symbol of ns.stock.getSymbols()) {
        const [stonks, avgPrice] = ns.stock.getPosition(symbol);
        //ns.print(`${symbol}: ${stonks} @ ${fmt.money(avgPrice)}`);
        if (stonks === 0) {
          continue;
        }
        const buyin = stonks * avgPrice;
        const gain = ns.stock.getSaleGain(symbol, stonks, "Long") - buyin;
        if (!(symbol in lastGains) || lastGains[symbol] !== gain) {
          //ns.print(`${symbol} Gain: ${fmt.money(gain)} (${fmt.percent(gain / buyin)})`);
          lastGains[symbol] = gain;
        }
        if (ns.stock.getForecast(symbol) < 0.5) {
          const price = ns.stock.sellStock(symbol, stonks);
          const profit = stonks * (price - avgPrice);
          if (price > 0) {
            ns.print(
              `Selling ${stonks} ${symbol} for final gain of ${fmt.money(
                profit
              )}`
            );
            ns.toast(
              `Sold ${stonks} ${symbol}. Profit: ${fmt.money(profit)}`,
              "success",
              7000
            );
            delete lastGains[symbol];
          } else {
            ns.print(`Failed to sell ${stonks} ${symbol}`);
            ns.toast(`Failed to sell ${stonks} ${symbol}`, "error", 10000);
          }
        }
      }

      const total = Object.values(lastGains).reduce((a, b) => a + b, 0);
      if (total !== lastTotal) {
        ns.print(`Total Gain: ${fmt.money(total)}`);
        lastTotal = total;
      }

      await ns.asleep(1000);
    }
  }
}
