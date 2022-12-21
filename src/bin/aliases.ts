import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const hostname = ns.getHostname();
  ns.tprint(
    "Copy-paste:\n" +
      ns
        .ls(hostname)
        .filter((file) => file.endsWith(".js") && file.startsWith("/dist/bin"))
        .map(
          (file) =>
            `alias ${file
              .replace(".js", "")
              .replace("/dist/bin/", "")}="run ${file}";`
        )
        .join("\n")
  );
}
