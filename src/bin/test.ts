import { NS } from "@ns";
import { waitForMessage } from "/ports";

export async function main(ns: NS): Promise<void> {
  const port = ns.getPortHandle(100);
  if (ns.args[0] === "write") {
    for (const x of ns.args.slice(1)) {
      port.write(x as string);
    }
  } else if (ns.args[0] === "wait") {
    ns.tprint(await waitForMessage(port, (data) => data === ns.args[1]));
  } else if (ns.args[0] === "clear") {
    port.clear();
  } else if (ns.args[0] === "write-and-clear") {
    port.write("whey");
    port.clear();
  } else if (ns.args[0] === "read") {
    ns.tprint(port.read());
  } else if (ns.args[0] === "peek") {
    ns.tprint(port.peek());
  }
}
