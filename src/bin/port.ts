import { NS } from '@ns';

import { waitForMessage } from '/ports';

export async function main(ns: NS): Promise<void> {
  const port = ns.getPortHandle(ns.args[0] as number);
  const command = ns.args[1] as string;
  if (command === "write") {
    for (const x of ns.args.slice(1)) {
      port.write(x as string);
    }
  } else if (command === "wait") {
    ns.tprint(await waitForMessage(port, (data) => data === ns.args[2]));
  } else if (command === "clear") {
    port.clear();
  } else if (command === "write-and-clear") {
    port.write(ns.args[2] as string);
    port.clear();
  } else if (command === "read") {
    ns.tprint(port.read());
  } else if (command === "peek") {
    ns.tprint(port.peek());
  } else if (command === "full") {
    ns.tprint(port.full());
  } else if (command === "consume") {
    let count = ns.args[2] as number;
    while (count > 0) {
      ns.tprint(port.read());
      count--;
    }
  }
}
