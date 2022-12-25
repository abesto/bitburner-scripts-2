// WATCH OUT: the "processes" in game are not actually isolated processes.
// A global variable as cache is shared by all of them.
import { NS, ProcessInfo } from '@ns';

export function getProcessInfo(ns: NS): ProcessInfo {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return ns.getRunningScript()!;
}
