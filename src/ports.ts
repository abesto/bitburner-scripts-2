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

const ping = JSON.stringify({ type: "ping" });

export async function waitForMessage(
  port: NetscriptPort,
  pred: (data: PortData) => boolean
): Promise<PortData> {
  while (port.empty() || !pred(port.peek())) {
    if (port.peek() === ping) {
      port.read();
      continue;
    }
    await port.nextWrite();
  }

  const message = port.read();
  if (!pred(message)) {
    throw new Error("Unexpected message");
  }

  // Trigger other nextWrite() calls
  port.write(ping);

  return message;
}
