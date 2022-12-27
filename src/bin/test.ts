38;
5;
import { NS } from '@ns';

import * as colors from '/colors';

export async function main(ns: NS): Promise<void> {
  ns.tprint("░▒█▂");
  ns.tprint("\u001b[38;5;101mfooo");
  ns.tprint("\u001b[38;2;100;100;255mbar");
}
