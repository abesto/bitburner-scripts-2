// Window management
import { NS } from '@ns';

export async function main(ns: NS): Promise<void> {
  const command = ns.args[0] as string;

  if (command === "r" || command === "resize") {
    const width = ns.args[1] as number;
    const height = ns.args[2] as number;
    const pid = ns.args[3] as number;
    ns.resizeTail(width, height, pid);
  }
}
