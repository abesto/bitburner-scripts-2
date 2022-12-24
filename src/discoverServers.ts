import { NS } from '@ns';

export function discoverServers(ns: NS): string[] {
  const queue = ["home"];
  const visited = new Set<string>();

  while (queue.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const server = queue.shift()!;
    if (visited.has(server)) {
      continue;
    }
    visited.add(server);
    const neighbors = ns.scan(server);
    for (const neighbor of neighbors) {
      queue.push(neighbor);
    }
  }

  return Array.from(visited);
}
