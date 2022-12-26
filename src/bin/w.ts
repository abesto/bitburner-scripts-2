// Window management
import { NS } from '@ns';

import { Log } from '/log';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "w");
  const command = ns.args[0] as string;

  if (command === "r" || command === "resize") {
    const width = ns.args[1] as number;
    const height = ns.args[2] as number;
    const pid = ns.args[3] as number;
    ns.resizeTail(width, height, pid);
  }
}
