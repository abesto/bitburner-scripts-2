import { NS } from '@ns';

import { Log } from '/log';

export async function main(ns: NS): Promise<void> {
  const log = new Log(ns, "test").scope("test2").scope("whoo");

  log.debug("whee", {
    foo: "bar",
    baz: 42,
    qux: true,
    quux: null,
    corge: undefined,
    grault: { garply: "waldo", fred: [12, "whoo"] },
  });

  log.info("whee", {
    foo: "bar",
    baz: 42,
    qux: true,
    quux: null,
    corge: undefined,
    grault: { garply: "waldo", fred: 123 },
  });
  log.warn("whee", {
    foo: "bar",
    baz: 42,
    qux: true,
    quux: null,
    corge: undefined,
    grault: { garply: "waldo", fred: 123 },
  });
  log.error("whee", {
    foo: "bar",
    baz: 42,
    qux: true,
    quux: null,
    corge: undefined,
    grault: { garply: "waldo", fred: 123 },
  });

  log.tdebug("whee", {
    foo: "bar",
    baz: 42,
    qux: true,
    quux: null,
    corge: undefined,
    grault: { garply: "waldo", fred: [12, "whoo"] },
  });
  log.tinfo("whee", {
    foo: "bar",
    baz: 42,
    qux: true,
    quux: null,
    corge: undefined,
    grault: { garply: "waldo", fred: 123 },
  });
  log.twarn("whee", {
    foo: "bar",

    baz: 42,
    qux: true,
    quux: null,
    corge: undefined,
    grault: { garply: "waldo", fred: 123 },
  });

  log.terror("whee", {
    foo: "bar",
    baz: 42,
    qux: true,
    quux: null,
    corge: undefined,
    grault: { garply: "waldo", fred: 123 },
  });
}
