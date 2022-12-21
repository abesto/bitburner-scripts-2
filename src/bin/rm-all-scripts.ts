import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const hostname = ns.getHostname();
  const me = ns.getScriptName();
  if (
    await ns.prompt(
      `Are you sure you want to delete all scripts on ${hostname}?`
    )
  ) {
    for (const file of ns.ls(hostname)) {
      if (file.endsWith(".js") && file !== me) {
        if (ns.rm(file)) {
          ns.tprint(`SUCCESS Deleted ${file}`);
        } else {
          ns.tprint(`ERROR Failed to delete ${file}`);
        }
      }
    }
  }
}
