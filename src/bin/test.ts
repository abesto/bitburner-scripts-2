import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  let count = 0;
  const port = ns.getPortHandle(1);
  while (!port.full()) {
    count += 1;
    port.write("wheeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
  }
  port.clear();
  ns.tprint(`Wrote ${count} messagesssss`);
}
