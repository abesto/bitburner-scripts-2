import { NS } from '@ns';

import * as colors from '/colors';

const FORMATS = {
  float: "0.000",
  money: "$0.000a",
  memory: "0.00 b",
};

const MoneySuffixes: { [suffix: string]: number } = {
  k: 3,
  m: 6,
  b: 9,
  t: 12,
};

export class Fmt {
  constructor(private ns: NS) {}

  money(n: number): string {
    return this.ns.nFormat(n, FORMATS.money);
  }

  float(n: number): string {
    return this.ns.nFormat(n, FORMATS.float);
  }

  intShort(n: number): string {
    return this.ns.nFormat(n, "0a");
  }

  time(t: number): string {
    return this.ns.tFormat(t);
  }

  timeShort(t: number): string {
    return this.ns.nFormat(t / 1000, "00:00:00");
  }

  timestamp(ms: number): string {
    const date = new Date(ms);
    return date.toISOString();
  }

  memory(t: number): string {
    return this.ns.nFormat(t * 1000 * 1000 * 1000, FORMATS.memory);
  }

  keyValue(...items: [string, string][]): string {
    return items.map(([key, value]) => `${key}=${value}`).join(" ");
  }

  keyValueTabulated(...rows: [string, ...[string, string][]][]): string[] {
    const strRows: [string, string[]][] = rows.map(([prefix, ...fields]) => [
      prefix,
      fields.map(([key, value]) => `${key}=${value}`),
    ]);

    const maxColumnLengths: number[] = strRows.reduce((acc, [_, fields]) => {
      fields.forEach((field, i) => {
        acc[i] = Math.max(acc[i] || 0, field.length);
      });
      return acc;
    }, [] as number[]);

    const maxPrefixLength = rows.reduce(
      (acc, [prefix, _]) => Math.max(acc, prefix.length),
      0
    );

    const lines: string[] = [];
    for (const [prefix, fields] of strRows) {
      lines.push(
        `[${prefix.padStart(maxPrefixLength)}] ${fields
          .map((field, i) => field.padEnd(maxColumnLengths[i]))
          .join(" ")}`
      );
    }

    return lines;
  }

  table(headers: string[], ...rows: string[][]): string[] {
    const maxColumnLengths = headers.map((header, i) =>
      Math.max(header.length, ...rows.map((row) => row[i].length))
    );

    return [
      headers.map((header, i) => header.padEnd(maxColumnLengths[i])).join("\t"),
      ...rows.map((row) =>
        row.map((field, i) => field.padEnd(maxColumnLengths[i])).join("\t")
      ),
    ];
  }

  parseMoney(x: string | number): number {
    if (typeof x === "string") {
      const [, num, suffix] = x.match(/^\$?([0-9.]+)([a-z]?)$/i) || [];
      return parseFloat(num) * 10 ** (MoneySuffixes[suffix] || 0);
    }
    return x;
  }

  percent(x: number): string {
    return `${Math.round(x * 100)}%`;
  }
}

export function highlightValue(value: unknown): string {
  if (typeof value === "string") {
    return colors.green(value);
  } else if (typeof value === "number" || typeof value === "boolean") {
    return value.toString();
  } else if (typeof value === "undefined" || value === null) {
    return colors.black(`${value}`);
  } else {
    return highlightJSON(value);
  }
}

export function highlightJSON(value: unknown): string {
  if (typeof value === "string") {
    return colors.green(`"${value.replaceAll('"', '\\"')}"`);
  } else if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined" ||
    value === null
  ) {
    return highlightValue(value);
  } else if (typeof value === "object") {
    if (Array.isArray(value)) {
      const parts = value.map((value) => highlightJSON(value));
      return "[" + parts.join(",") + "]";
    }
    const parts = Object.entries(value).map(([key, value]) => {
      return `${colors.cyan(
        '"' + key.replaceAll('"', '\\"') + '"'
      )}:${highlightJSON(value)}`;
    });

    return "{" + parts.join(",") + "}";
  }
  throw new Error("unreachable");
}
