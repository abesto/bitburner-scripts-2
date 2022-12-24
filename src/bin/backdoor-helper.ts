import { AutocompleteData, NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const queue: string[][] = [[ns.getHostname()]];
  const seen: string[] = [];

  while (queue.length > 0) {
    const path = queue.shift() as string[];
    const hostname = path[path.length - 1];

    if (seen.includes(hostname)) {
      continue;
    }
    seen.push(hostname);

    if (
      (ns.args[0] === undefined ||
        ns.args[0] === "--one" ||
        hostname.startsWith(ns.args[0] as string)) &&
      !ns.getServer(hostname).backdoorInstalled &&
      !ns.getServer(hostname).purchasedByPlayer
    ) {
      ns.tprintf(
        `home; ${path
          .filter((h) => h != "home")
          .map((h) => `connect ${h}`)
          .join("; ")}; backdoor`
      );

      if (ns.args[0] === "--one") {
        return;
      }
    }

    for (const next of ns.scan(hostname)) {
      queue.push([...path, next]);
    }
  }
}

export function autocomplete(data: AutocompleteData, args: string[]): string[] {
  if (args.length === 1) {
    return data.servers.filter((server) => server.startsWith(args[0]));
  }
  return data.servers;
}
