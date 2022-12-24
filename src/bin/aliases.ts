import { NS } from "@ns";

export async function main(ns: NS): Promise<void> {
  const hostname = ns.getHostname();
  ns.tprint(
    "Copy-paste:\n" +
      ns
        .ls(hostname)
        .filter((file) => file.match(/^\/bin\/[^/]*\.js$/))
        .map(
          (file) =>
            `alias ${file
              .replace(".js", "")
              .replace("/bin/", "")}="run ${file}";`
        )
        .join("\n")
  );
}
