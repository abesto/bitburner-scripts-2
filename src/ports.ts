import { NS, NetscriptPort, PortData } from "@ns";

export function supervisorControl(ns: NS): NetscriptPort {
  return ns.getPortHandle(1);
}

export function supervisorEvents(ns: NS): NetscriptPort {
  return ns.getPortHandle(2);
}

export function dbLockPort(ns: NS): NetscriptPort {
  return ns.getPortHandle(3);
}

export function findPortMessage(
  port: NetscriptPort,
  pred: (data: PortData) => boolean
): PortData | null {
  const messages = [];

  while (!port.empty()) {
    messages.push(port.read());
  }

  const index = messages.findIndex(pred);
  const retval = index !== -1 ? messages[index] : null;

  messages.forEach((message) => {
    if (message !== retval) {
      port.write(message);
    }
  });

  return retval;
}
