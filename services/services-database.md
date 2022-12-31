---
description: A Glorified Global Lock
---

# services/Database

* Code: [https://github.com/abesto/bitburner-scripts-2/tree/main/src/services/Database](https://github.com/abesto/bitburner-scripts-2/tree/main/src/services/Database)
* Dependencies:
  * Must run on `home` (more specifically: needs filesystem access to the database file)
  * The client requires [services-portregistry.md](services-portregistry.md "mention") to be running
* In-game RAM: 1.95GB
* Related CLIs: `bin/db`

Normal usage won't touch a `DatabaseClient` directly, but instead use the `db`, `dbSync`, and `dbLock` functions from the same file.

## Usage Examples

```typescript
// Get an in-memory, read-only snapshot of the database
const memdb = await db(this.ns, this.log);
```

```typescript
// Get an in-memory, read-only snapshot of the database
// without yielding; only works on the same host as DatabaseService
const memdb = dbSync(this.ns);
```

```typescript
// Lock the database
await dbLock(ns, log, async (memdb) => {
  memdb.foo = bar;  // Make some changes
  if (shouldSave) {
    return memdb;  // Persist the changes made on `memdb`
  } else {
    return;  // Leave the database untouched, changes to `memdb` are discarded
  }
});
```

## Global Write Lock

I decided "for the lolz" to store all persistent data in a single file (with a possible future exemption for [services-stats.md](services-stats.md "mention") which has _very_ special needs). In principle all processes could just read and write the file as needed. However, this exposes us to two kinds of race problems:

* Async race conditions. A process might read the file, make an async call, then write updated contents to the file. "Making an async call" yields control to the JS runtime, which may decide to schedule arbitrary other coroutines. If another such coroutine happens to write to the database, the original process won't know about them, and their changes will be lost.
* Scripts run on multiple Bitburner hosts. To read/write the file, we'd need to keep `scp`-ing it around; and I've found that to fail fairly often, for some reason.

So instead let's create `Database` service that exclusively manages access to the database. As this is a single point that all access goes through, we can serialize write operations with a lock queue managed inside the service, and keep the clients simple.

## API and Behavior Overview

### `read`

Very simple: read the database, serialize it to JSON, and pass it to the client. The fact that the serialization format is JSON is encoded in exactly two places (one in the server, one in `DatabaseClient`), so changeg that detail would be trivial if it turned out to be a performance / memory bottleneck.

Notably, the `db()` and `dbSync()` functions mentioned above sit add a bit of optimization: if we're on the `home` host, then we don't talk to the `Database` service at all, but instead read the file directly from disk. `dbSync` exists so you can say: I know I'm on `home`, don't even _think_ about yielding control, just read the file from disk please thank you.

### `lock`

The request includes information about the calling process (pid, hostname, filename, and arguments). The service uses this for two purposes:

* to validate later `unlock` requests - if you try to unlock the database while you don't have the lock, you get an error and nothing happens to the database
* to check every second whether the holder of the lock has crashed; in that case, the service automatically breaks the lock

There are two possible scenarios for handling this request:

* The database is currently unlocked. In this case, the service updates its state to take note of the new lock, and returns the serialized database (now containing the lock itself) to the client.
* The database is currently locked. In this case, the service adds the lock request to its internal lock queue, and returns the string `"ack"` to the client.

`unlock` / `writeAndUnlock`

The service first verifies that the request is for the holder of the lock.

If the request is a `writeAndUnlock`, then it updates the database on disk with the new contents included in request. Crucially, it overwrites the lock queue in the database passed in the request with lock metadata freshly read from the filesystem. This is necessary in the following scenario:

* Client A locks the DB, and receives a DB snapshot from this point in time.
* Client B sends a lock request, gets added to the lock queue
* Client B sends a `writeAndUnlock`. The DB contents in this request don't contain the lock request of client B.

In either case, after a successful unlock request (or after breaking a stale lock), the service shifts the next item from the lock queue, and notifies its client that it now has the lock (passing along a brand-new DB snapshot). This message travels in a special `DatabaseResponse.lockDeferred` message.

## Room for Improvement

This is fairly basic, as far as databases go. Ideally I'd replace the API with something similar to the API of Redis. That said, the actual database is _tiny_, and in practice it's all in memory on the real computer, so performance is fine.

