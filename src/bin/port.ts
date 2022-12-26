import { NS } from '@ns';

import { Log } from '/log';
import { waitForMessage } from '/ports';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "port");
  const portNumber = ns.args[0] as number;
  const port = ns.getPortHandle(portNumber);
  const command = ns.args[1] as string;
  if (command === "write") {
    for (const x of ns.args.slice(1)) {
      port.write(x as string);
    }
  } else if (command === "wait") {
    log.tinfo("wait", {
      message: await waitForMessage(port, (data) => data === ns.args[2]),
    });
  } else if (command === "clear") {
    port.clear();
  } else if (command === "write-and-clear") {
    port.write(ns.args[2] as string);
    port.clear();
  } else if (command === "read") {
    log.tinfo("read", { portNumber, message: await port.read() });
  } else if (command === "peek") {
    log.tinfo("peek", { portNumber, message: await port.peek() });
  } else if (command === "full") {
    log.tinfo("full", { portNumber, response: await port.full() });
  } else if (command === "consume") {
    let count = ns.args[2] as number | undefined;
    while (count === undefined || count > 0) {
      if (port.empty()) {
        await port.nextWrite();
      }
      log.tinfo("consume", { portNumber, message: await port.read() });
      if (count) {
        count--;
      }
    }
  } else {
    log.terror("Unknown command", { command });
  }
}
