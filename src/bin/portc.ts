// CLI for PortRegistry
import { NS } from "@ns";
import { PortRegistryClient } from "/services/PortRegistry/client";

export async function main(ns: NS): Promise<void> {
  ns.disableLog("ALL");

  const args = ns.flags([["seconds", 0]]);
  const posArgs = args._ as string[];
  const command = posArgs[0];

  const client = new PortRegistryClient(ns);

  if (command === "status") {
    const status = await client.status();
    ns.tprint(
      `INFO PortRegistry status: ${status.status} freeHigh=${status.freeHigh}`
    );
    ns.tprint(`INFO     Reusable ports: ${JSON.stringify(status.free)}`);
    ns.tprint("INFO     Reserved ports:");
    for (const { port, hostname, pid } of status.reserved) {
      const process = ns.ps(hostname).find((p) => p.pid === pid);
      const procStr = process
        ? `${process.filename} ${process.args.join(" ")}`
        : "(stopped)";
      ns.tprint(`INFO       ${port} ${hostname}:${pid} ${procStr}`);
    }
  } else if (command === "reserve") {
    const seconds = args.seconds as number;
    if (seconds <= 0) {
      throw new Error("ERROR Invalid or missing --seconds");
    }
    const port = await client.reservePort();
    await ns.sleep(seconds * 1000);
    await client.releasePort(port);
  } else {
    ns.tprint(`ERROR Unknown command: ${command}`);
  }
}
