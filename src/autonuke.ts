import { NS } from "@ns";

export function autonuke(ns: NS, host: string, verbose?: boolean): boolean {
  if (ns.hasRootAccess(host)) {
    return true;
  }

  const hackingLevel = ns.getHackingLevel();
  const hostHackingLevel = ns.getServerRequiredHackingLevel(host);

  if (hackingLevel < hostHackingLevel) {
    if (verbose) {
      ns.tprint(
        `SKIP ${host}: hacking level too low: ${hackingLevel} < ${hostHackingLevel}`
      );
    }
    return false;
  }

  if (ns.fileExists("BruteSSH.exe")) {
    ns.brutessh(host);
  } else {
    if (verbose) {
      ns.tprint(`MISS ${host}: missing BruteSSH.exe`);
    }
  }

  if (ns.fileExists("FTPCrack.exe")) {
    ns.ftpcrack(host);
  } else {
    if (verbose) {
      ns.tprint(`MISS ${host}: missing FTPCrack.exe`);
    }
  }

  if (ns.fileExists("HTTPWorm.exe")) {
    ns.httpworm(host);
  } else {
    if (verbose) {
      ns.tprint(`MISS ${host}: missing HTTPWorm.exe`);
    }
  }

  if (ns.fileExists("SQLInject.exe")) {
    ns.sqlinject(host);
  } else {
    if (verbose) {
      ns.tprint(`MISS ${host}: missing SQLInject.exe`);
    }
  }

  if (ns.fileExists("relaySMTP.exe")) {
    ns.relaysmtp(host);
  } else {
    if (verbose) {
      ns.tprint(`MISS ${host}: missing relaySMTP.exe`);
    }
  }

  try {
    ns.nuke(host);
    return true;
  } catch (e) {
    if (verbose) {
      ns.tprint(`FAIL ${host}: ${e}`);
    }
    return false;
  }
}
