---
description: Talking to Services, for Humans
---

# CLIs

<figure><img src=".gitbook/assets/image (1).png" alt=""><figcaption></figcaption></figure>

In an ideal world, a CLI would just be an automatically generated wrapper around the API for a service. This isn't quite practical for a few reasons, so we need to solve:

* Input - writing JSON requests by hand is not my idea of a good time
  * Yes, you could auto-generate options based on the API, and end up with the AWS CLI. Also not my idea of a good time. We can (and should) be more ergonomic.
* Output - readi"Ong JSON responses is also not my idea of a good time. Output needs to be mostly formatted for humans.
  * To keep things simple, I mostly write output using [log.md](libraries/log.md "mention") (see the screenshot above).

{% hint style="info" %}
You may notice in the screenshot that I write `boot` instead of `run bin/boot.js`. That's thanks to [bin-aliases.md](other-binaries/bin-aliases.md "mention").
{% endhint %}

## Argument Parsing

Bitburner provides the `ns.flags` option for argument parsing. It goes something like this:

```typescript
  const args = ns.flags([
    ["job", ""],
    ["task", -1],
    ["initial", false],
    ["dry-run", false],
  ]);
  const host = (args._ as string[])[0];

  const jobId = args["job"] as string;
  const taskId = args["task"] as number;
  const initial = args["initial"] as boolean;
```

Simple, functional. It has a few notable limitations:

* No support for marking required / optional positional args - you get to parse those yourself
* No special support for `--`
* Explodes if passed any unexpected options, with no way to disable this
* No `--help` generation

I went shopping for existing real-world CLI argument parsing libraries, and here's what I found. All of them have hard dependencies on NodeJS modules like `path`. You can pull in stuff like [https://github.com/browserify/path-browserify](https://github.com/browserify/path-browserify) to work around that, however those libraries inevitably refer to things like `document`, which Bitburner hits with a massive RAM penalty. Can't have that.

The only real alternative I found is [https://github.com/minimistjs/minimist](https://github.com/minimistjs/minimist), with a very similar syntax to `ns.flags`. The trade-off goes: `minimist` doesn't do default values, but it doesn't explode on unexpected options.

And you can forget about auto-generated `--help` (unless you write the code for it yourself, which I didn't, but kinda want to).

## ... a thin wrapper ...

Here's a thing worth calling out: try to avoid putting much logic into a CLI beyond input / output formatting. This is a good rule of thumb to ensure that anything _you_ can do, any services can also do. That's the way towards composable services taking you to ever higher levels of abstraction and enlightenment.
