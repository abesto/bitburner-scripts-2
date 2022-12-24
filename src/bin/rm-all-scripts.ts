import { NS } from '@ns';

import { Log } from '/log';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "rm-all-scripts");
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
          log.tinfo("Deleted", { file });
        } else {
          log.terror("Failed to delete", { file });
        }
      }
    }
  }
}
