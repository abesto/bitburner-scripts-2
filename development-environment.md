---
description: Going from TS on your computer to JS in Bitburner
---

# Development Environment

Bitburner has an integrated code editor with syntax highlighting for JS, but for any serious project that's not nearly enough. I want version control, and I want a full-fledged IDE. Luckily the pieces for this already exist.

I chose to write my code for Bitburner in TypeScript for the static type safety it provides. This means we need a flow that goes as follows. "Local" here refers to the real computer, and "remote" to the Bitburner `home` machine.

* I change some TS code locally
* The code automatically is compiled to JS
* The compiled JS is automatically uploaded to Bitburner

For the syncing part, there's an official VSCode extension that exposes a port the game can then connect to. The API itself is described in [https://bitburner.readthedocs.io/en/latest/remoteapi.html](https://bitburner.readthedocs.io/en/latest/remoteapi.html).

{% hint style="warning" %}
There's also an older method for connecting editor to game, called the Server API. You'll want **Remote API**, not **Server API**.
{% endhint %}

There exists an evolving ecosystem of tools around making this process painless. In particular, [https://github.com/Tanimodori/viteburner](https://github.com/Tanimodori/viteburner) is amazing. Unfortunately at the time of writing (and this may change in the near future) `viteburner` doesn't support uploading NPM dependencies into the game - and I do really need a few libraries to not go insane.

My current approach goes like this, adopted and tweaked from [https://github.com/bitburner-official/typescript-template](https://github.com/bitburner-official/typescript-template):

* `npm run watch:transpile`: `esbuild` watches `.ts` files under `src/bin` and compiles them to `.js` ([code](https://github.com/abesto/bitburner-scripts-2/blob/742bfb15223377239eed3be2a726dbc2b1b5e664/build/transpile.js)). Note that
  * `esbuild` bundles everything needed for a Netburner "binary" into a single JS file
  * It understands dependencies, so a change in a library will trigger a rebuild of all the binaries that import it
  * `chokidar` is used to notice newly created files. This probably means we're paying some extra performance cost, since `esbuild` is invoked separately for each binary.
* `npm run watch:local`: takes care of static text files ([code](https://github.com/abesto/bitburner-scripts-2/blob/742bfb15223377239eed3be2a726dbc2b1b5e664/build/watch.js))
* `npm run watch:remote`: uploads files to the game using [https://github.com/bitburner-official/bitburner-filesync](https://github.com/bitburner-official/bitburner-filesync), and crucially, downloads the TypeScript type definition from the game for the game API. This enables both the TypeScript compiler and VSCode to understand how to talk to the game.
* `npm run watch` runs all of these ([code](https://github.com/abesto/bitburner-scripts-2/blob/main/package.json))

Remember that in Remote API, the _game_ is the network client, so `npm watch` must be running before the game can connect to it. You can un/reconnect to the API under Options / Remote API in-game.

<figure><img src=".gitbook/assets/image.png" alt=""><figcaption></figcaption></figure>

