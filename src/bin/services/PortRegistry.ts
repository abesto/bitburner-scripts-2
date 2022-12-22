import { NS } from "@ns";
import { PortRegistryService } from "/services/PortRegistry/service";

export async function main(ns: NS): Promise<void> {
  const portRegistry = new PortRegistryService(ns);
  await portRegistry.listen();
}
