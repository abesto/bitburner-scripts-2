---
cover: .gitbook/assets/Screenshot 2022-12-31 124510 (1).jpg
coverY: 0
---

# Overview and Introduction

## About This Gitbook

In this document I describe my approach to doing things in Bitburner with a service-oriented approach. There's no strict reading order, feel free to jump around. This page serves as an overview and introduction.

Said approach lives in [gh:abesto/bitburner-scripts-2](https://github.com/abesto/bitburner-scripts-2). Watch out: this is _not_ intended as up-to-date documentation on the code in the repo. I may or may not update it, as the fancy takes me.

This document **does NOT contain story spoilers**. However, the code in the repository may, so be advised of that if you go looking. Further, you may consider this whole thing a spoiler in that a lot of the fun of Bitburner is figuring out how to solve problems.

Most pages in the document correspond to a directory or file in the source tree. These pages contain a link to the file near the top, and are named accordingly.

## What's Bitburner?

> Bitburner is a programming-based [incremental game](https://en.wikipedia.org/wiki/Incremental\_game) that revolves around hacking and cyberpunk themes. The game is currently in the early beta stage of development. It [can be played here](https://danielyxie.github.io/bitburner/).

There's also a [Steam release](https://store.steampowered.com/app/1812820/Bitburner/) which is also free. If you're here somehow, and not familiar with Bitburner, you may want to stop reading here and check it out - it's tons of fun! Also the rest of this probably won't make too much sense if you haven't messed around with it before.

## About Services

### What's a Service?

In the context of Bitburner, what I mean by a "service" is a long-running process that

* implements a single, useful piece of functionality (yes "single piece of functionality" has a lot of room for bending the definition, and that's fine)
* May be configured using a config file. If it is, it should _very_ frequently respond to configuration changes
* May expose an API to trigger some action / behavior

You may think that's a bit vague, but it's enough to motivate this approach, and also enough to constrain the design space from "dunno, write some scripts I guess" to something quite specific.

### Why Services?

In the real world, services are sometimes a good idea for a wide variety of reasons, and they're sometimes a bad idea for an also wide variety of reasons. The world of Bitburner is _much_ simpler, so it's also easier to reason about why / whether you should take a service-oriented approach. Here's why I did it:

* Bitburner pretends to be multiple computers that can run processes, and there exist something called "ports" (which, watch out, have nothing to do with real-world network ports). That means it pretends to be a _distributed computing environment_. And if I see one of those, then I can't help by try to apply my decade of experience working with distributed systems to it!
* APIs are great. In particular: they allow exposing functionality in a way that both you (via [clis.md](clis.md "mention")) and other services can invoke the same functionalities. This means you can build a pyramid of services with ever higher levels of functionality, and also manually interact with any piece of your "infrastructure". This bit in particular is not possible (or at least not as clean) if you structure your approach primarily using libraries.
* The only in-game computing resource is RAM. Memory usage of a script is calculated by the game by looking at what game-API functions the script invokes. Services allow you to centralize and de-duplicate the memory cost of calling API functions.
  * At its most extreme, you could implement services _just_ to wrap game-API functions in a way to minimize RAM usage. I consider that a bit more cheeky than I want in _my_ play-through, but you do you! Also, the [#performance](libraries/services-common-baseservice.md#performance "mention") overhead may be prohibitive.

## Overview

This section provides a walk-through of the various components, and how they fit together. Click through to the links for more detailed descriptions of each one.

* Step zero: a [development-environment.md](development-environment.md "mention"). We need a way to write code in an actual IDE, and have it be reflected in-game with no clicks.
* There are some pieces of common functionality that all services share: listening on a port, sending responses, periodic tasks specific to the service, that kind of stuff. All this is implemented in [services-common-baseservice.md](libraries/services-common-baseservice.md "mention").
* There's also some amount of shared logic between all clients of services. No surprises: that's encapsulated in [services-common-baseclient.md](libraries/services-common-baseclient.md "mention").
* There are distinct pieces of the implementation of a service that are useful to break out into a standard structure. This is documented in [service-conventions.md](service-conventions.md "mention").
* Providing an API is in any definition of a service. "Providing" an API means: there must be a way for other processes to invoke functionality. Bitburner "Ports" don't trivially provide this capability; [services-portregistry.md](services/services-portregistry.md "mention")does.
* Some services need to persist state between restarts. Some services also consume configuration. I decided to chuck all this into a single JSON file, with [services-database.md](services/services-database.md "mention") managing access to it.
  * I did this mainly as an experiment to see if I could. It does have one benefit: it means higher-level services can run on any host, since they don't depend on having the config / database file locally.
* Running huge amounts of processes across many servers is a core piece of the Bitburner puzzle. While we're at it, we may as well throw in managing the lifecycle of other services. [services-scheduler.md](services/services-scheduler.md "mention") does all this and more.
* [Observability](https://en.wikipedia.org/wiki/Software\_observability) in any software-oriented architecture is paramount. You have many components doing their thing; you need a way to understand what happens when and why.
  * The [log.md](libraries/log.md "mention") library provides logging. Main features: timestamps and key-value support.
  * [services-stats.md](services/services-stats.md "mention") is a simple time-series database. Yes, really. Over-engineering, you say? THAT'S THE POINT!
* A well-documented approach to the "hacking servers for money" challenge in Bitburner is referred to as HWGW. My implementation of this (at the time of writing) lives in [bin-hwgw-controller.md](other-binaries/bin-hwgw-controller.md "mention") and [bin-hwgw-batch.md](other-binaries/bin-hwgw-batch.md "mention").
  * While developing a "HWGW Batcher", a good visualizer is super useful. I built [services-hwgwbatchviz.md](services/services-hwgwbatchviz.md "mention") for this purpose.
  * [bin-hwgw-monitor.md](other-binaries/bin-hwgw-monitor.md "mention") uses [services-stats.md](services/services-stats.md "mention") to display monitoring data over time about each HWGW process.
* Turn-up of any complex set of services requires some coordination. In our case: The Scheduler manages all services, but it needs to talk to the Database. That's a circular dependency that needs to be handled _somehow_. [bin-boot.md](other-binaries/bin-boot.md "mention") takes care of that.
