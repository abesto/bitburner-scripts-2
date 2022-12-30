import { NetscriptPort, NS, PortData } from '@ns';

import { SERVICE_ID as DATABASE } from './services/Database/types';
import { SERVICE_ID as HWGW_BATCH_VIZ } from './services/HWGwBatchViz/types';
import { SERVICE_ID as PORT_REGISTRY } from './services/PortRegistry/types';
import { SERVICE_ID as SCHEDULER } from './services/Scheduler/types';
import { SERVICE_ID as STATS } from './services/Stats/types';

export const PORTS = {
  [SCHEDULER]: 1,
  [PORT_REGISTRY]: 4,
  FreePorts: 5,
  [DATABASE]: 6,
  [HWGW_BATCH_VIZ]: 7,
  [STATS]: 8,
};

export function supervisorControl(ns: NS): NetscriptPort {
  return ns.getPortHandle(PORTS[SCHEDULER]);
}

export function portRegistry(ns: NS): NetscriptPort {
  return ns.getPortHandle(PORTS[PORT_REGISTRY]);
}

export function freePorts(ns: NS): NetscriptPort {
  return ns.getPortHandle(PORTS.FreePorts);
}

const ping = JSON.stringify({ type: "ping" });

export async function waitForMessage(
  port: NetscriptPort,
  pred: (data: PortData) => boolean
): Promise<PortData> {
  while (port.empty() || !pred(port.peek())) {
    // Ignore pings
    if (port.peek() === ping) {
      port.read();
      continue;
    }

    // Drop old messages
    try {
      const message = JSON.parse(port.peek().toString());
      if (message.timestamp < Date.now() - 1000) {
        port.read();
        continue;
      }
    } catch (e) {
      // Ignore
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
