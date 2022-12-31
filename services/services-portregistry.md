---
description: Network Connections for Bitburners
---

# services/PortRegistry

* Code: [https://github.com/abesto/bitburner-scripts-2/tree/main/src/services/PortRegistry](https://github.com/abesto/bitburner-scripts-2/tree/main/src/services/PortRegistry)
* Dependencies: none

## Usage Example

```typescript
const log = new Log(ns, "example");
const fmt = new Fmt(ns);
const portRegistryClient = new PortRegistryClient(ns, log);
const responsePort = await portRegistryClient.reservePort();
// Use `responsePort` to construct another client and use it. Then later:
await portRegistryClient.releasePort(responsePort);
```

There's also a helper to avoid having to deal with all this:

```typescript
import { withClient } from '/services/client_factory';

// ...

await withClient(SchedulerClient, ns, log, async (client) => {
  log.tinfo("Scheduler services", {
    services: (await client.status()).services,
  });
});
```

## What's a Port?

In a real networking environment the operating system / standard libraries provide ports as an abstraction over the wire coming out the back of the server. For Bitburner, you need to forget all about that. There exist ports in Bitburner, and they have nothing to do with real-world ports. Here's what a port is in Bitburner:

* A global queue with limited length that can contain strings or numbers
* That's it, that is all a port is

These ports are shared globally across all processes on all hosts. Any process can push, shift, or peek a port at any time for free (as far as in-game RAM accounting goes).

It used to be the case that you had 20 ports to use, and that's it. This has been changed in recent Bitburner versions, enabling the below design.

## Port Allocation

Obviously for a client to talk to a service, we need to establish a reliable two-way connection between them. The server side is easy: a simple global constant mapping service names to the ports the services listen on is enough.

The client side is trickier. In the real world when you open a connection, a client port is automatically allocated for you. How can we replicate this concept of "a client port being allocated"?

The core of the problem is: we need a way for a client to _atomically_ get a free port, such that it's guaranteed no other client will get that port. The easiest way for this I can think of is: push free port numbers into a well-known port (call that `PORTS.FreePorts`). When a client needs a port, it shifts it out of `PORTS.FreePorts`, and boom, it's allocated now!

{% hint style="info" %}
We could use files as the main primitive of communication. In my first early attempt I did that, and found that `scp` fails fairly often, for reasons I never managed to debug. Since we'll want to communicate between processes running on different hosts, that's a show-stopper.

Also, there are things called "ports". We gotta use those!
{% endhint %}

Of course we also want a way to release ports once we're done with them. But we can't just push them back on `PORTS.FreePorts`, because what if it's already full? We'll lose a port! Even worse, what if a process crashes while it has a port allocated? And finally, what will populate `PORTS.FreePorts` in the first place? Naturally the answer to all these is: `services/PortRegistry/service.ts` exists to solve this, along with `services/PortRegistry/client.ts` to encapsulate the client-side logic.

Here's what the complete workflow looks like:

* `PortRegistry` pushes free port numbers into `PORTS.FreePorts` at the start of handling every request, and also every second
  * Initially, free ports start at port number 1024
  * `PortRegistry` also clears `PORTS.FreePorts` at startup to prevent _confusion_, see [#limitations-of-the-current-implementation](services-portregistry.md#limitations-of-the-current-implementation "mention")
* A client reads (shifts) a free port number out of `PORTS.FreePorts`
* The client sends a `PortRegistryRequest.reserve({port, hostname, pid})` to `PortRegistry`. `PortRegistry` takes note of this, and checks every second to see if the process is still running; if not, then it marks the port as available for reuse: next time it pushes ports into `PORTS.FreePorts`, it can push this.
  * The service also checks whether the port is already reserved. If it is, then it kills the process trying to make the new reservation, and prints an error to the Bitburner terminal.
* The client does its thing
* Ideally the client later comes back with a `PortRegistryRequest.releasePort({port, hostname, pid})`. The service checks this against the reservation it has on file, and marks the port free if it's a match.
* Whenever a port is allocated or pushed into `PORTS.FreePorts`, the both the client and the service clear it of any data. This is to ensure there's no leftover messages on a reused port.

## Request/Response

So far we have a server port, and a client port, but no concept of a connection. It should be completely possible to implement stateful connections a 'la TCP, but I decided to keep my life simple. Any request that needs a response includes a field called (by convention) `responsePort`. This is the client port we allocated above.

Injecting this port is made easy by [services-common-baseclient.md](../libraries/services-common-baseclient.md "mention"), and is completely hidden away by the client library for each service. This means "user code" can just do `const response = await client.method(params)`, as you'd expect in any sane system.

## Limitations of the Current Implementation

My current implementation of `PortRegistry` stores everything in memory. This means that if `PortRegistry` is restarted, then things will get very confused for a while. There are safeguards in place in low-level libraries used by [services-common-baseservice.md](../libraries/services-common-baseservice.md "mention") and [services-common-baseclient.md](../libraries/services-common-baseclient.md "mention") that shout if they receive messages not intended for them, so it won't be _too_ bad, but a safe restart mechanism would be good to implement. Or better yet, persisting the state on disk, but without introducing a dependency on [services-database.md](services-database.md "mention").

`releasePort` in the client is currently an `async` function: it uses `BaseClient.send` instead of `BaseClient.sendSync`. The difference is that `BaseClient.send` does a few backoffs-and-retries if the destination port happens to be full. Since `releasePort` is `async`, it can't be used in `ns.atExit`, which is a bit of a bummer. I could use `sendSync` in it instead, and use it in `atExit` all the time, at the cost of possibly losing some release requests. Ultimately it doesn't matter: `PortRegistry` notices when the process exits _anyway_.
