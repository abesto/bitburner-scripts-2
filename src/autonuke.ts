import { NS } from "@ns";

export function autonuke(ns: NS, host: string): boolean {
  if (ns.hasRootAccess(host)) {
    return true;
  }

  const hackingLevel = ns.getHackingLevel();
  const hostHackingLevel = ns.getServerRequiredHackingLevel(host);

  if (hackingLevel < hostHackingLevel) {
    return false;
  }

  if (ns.fileExists("BruteSSH.exe")) {
    ns.brutessh(host);
  }
  if (ns.fileExists("FTPCrack.exe")) {
    ns.ftpcrack(host);
  }
  if (ns.fileExists("HTTPWorm.exe")) {
    ns.httpworm(host);
  }
  if (ns.fileExists("SQLInject.exe")) {
    ns.sqlinject(host);
  }
  if (ns.fileExists("relaySMTP.exe")) {
    ns.relaysmtp(host);
  }

  const requiredPorts = ns.getServerNumPortsRequired(host);
  const ports = ns.getServer(host).openPortCount;
  if (ports < requiredPorts) {
    return false;
  }

  ns.nuke(host);
  return true;
}
