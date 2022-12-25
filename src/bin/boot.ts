// Start up low-level services in the right order, with some manual plumbing
import { NS } from '@ns';

import { dbLock } from '/database';
import { Log } from '/log';
import { freePorts, PORTS } from '/ports';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "boot");

  const DATABASE = "/bin/services/Database.js";
  const SCHEDULER = "/bin/services/Scheduler.js";
  const PORT_REGISTRY = "/bin/services/PortRegistry.js";
  if (ns.getRunningScript(DATABASE) !== null) {
    log.tinfo("Database already running");
    return;
  }
  if (ns.getRunningScript(SCHEDULER) !== null) {
    log.tinfo("Scheduler already running");
    return;
  }
  if (ns.getRunningScript(PORT_REGISTRY) !== null) {
    log.tinfo("PortRegistry already running");
    return;
  }

  ns.clearPort(PORTS.FreePorts);
  log.tinfo("Cleared FreePorts");

  const dbPid = ns.run(DATABASE);
  if (dbPid === 0) {
    log.terror("Failed to start database");
    return;
  }
  log.tinfo("Started DatabaseService", { pid: dbPid });

  // Spin up `PortRegistry` so we (and the `Scheduler`) can talk to the database service
  const freePortsPort = freePorts(ns);
  const portRegistryPid = ns.run(PORT_REGISTRY);
  if (portRegistryPid === 0) {
    log.terror("Failed to start PortRegistry");
    return;
  }
  log.tinfo("Started PortRegistry", { pid: portRegistryPid });
  if (freePortsPort.empty()) {
    await freePorts(ns).nextWrite();
  }

  // Inject the `PortRegistry` and `Database` services into the `Scheduler` database
  const spec = JSON.parse(ns.read("/bin/services/specs.json.txt"));
  await dbLock(ns, log, async (memdb) => {
    memdb.scheduler.services.PortRegistry = {
      status: {
        _type: "running",
        pid: portRegistryPid,
        hostname: "home",
        startedAt: Date.now(),
      },
      enabled: spec.PortRegistry.enableWhenDiscovered !== false,
      spec: {
        name: "PortRegistry",
        hostAffinity: spec.PortRegistry.hostAffinity,
      },
    };

    memdb.scheduler.services.Database = {
      status: {
        _type: "running",
        pid: dbPid,
        hostname: "home",
        startedAt: Date.now(),
      },
      enabled: spec.Database.enableWhenDiscovered !== false,
      spec: {
        name: "Database",
        hostAffinity: spec.Database.hostAffinity,
      },
    };

    return memdb;
  });
  log.tinfo("Registered Database and PortRegistry in Scheduler database");

  const schedulerPid = ns.run(SCHEDULER);
  if (schedulerPid === 0) {
    log.terror("Failed to start Scheduler");
    return;
  }
  log.tinfo("Started Scheduler", { pid: schedulerPid });

  await ns.sleep(1000);
  let failed = false;
  if (!ns.isRunning(schedulerPid)) {
    log.terror("Scheduler crashed", { pid: schedulerPid });
    failed = true;
  }
  if (!ns.isRunning(dbPid)) {
    log.terror("Database crashed", { pid: dbPid });
    failed = true;
  }
  if (!ns.isRunning(portRegistryPid)) {
    log.terror("PortRegistry crashed", { pid: portRegistryPid });
    failed = true;
  }

  if (failed) {
    ns.kill(schedulerPid);
    ns.kill(dbPid);
    ns.kill(portRegistryPid);
    log.terror("Killed all started processes due to boot failure");
  } else {
    log.tinfo("Boot process complete");
  }
}
