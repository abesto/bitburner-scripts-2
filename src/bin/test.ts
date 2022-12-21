import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const port = ns.getPortHandle(100);
  if (ns.args[0] === "write") {
    port.write("hello world");
  } else if (ns.args[0] === "wait-write") {
    await port.nextWrite();
    ns.tprint(ns.readPort(100));
  } else if (ns.args[0] === "clear") {
    port.clear();
  } else if (ns.args[0] === "write-and-clear") {
    port.write("whey");
    port.clear();
  }
}
