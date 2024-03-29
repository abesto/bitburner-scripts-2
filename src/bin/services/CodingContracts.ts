// Automatically discover and solve coding contracts
import { NS } from "@ns";

import deepEqual from "deep-equal";

import { discoverServers } from "/discoverServers";
import { Log } from "/log";

class CodingContracts {
  private readonly log: Log;
  private readonly complainedAboutMissing: Set<string>;
  private readonly failed: Set<string>;

  constructor(private readonly ns: NS) {
    this.log = new Log(ns, "CodingContracts");
    this.complainedAboutMissing = new Set();
    this.failed = new Set();
  }

  async run() {
    for (const host of discoverServers(this.ns)) {
      for (const file of this.ns.ls(host)) {
        if (file.endsWith(".cct")) {
          await this.handle(host, file);
        }
      }
    }
  }

  private async handle(host: string, file: string) {
    const id = `${host}:${file}`;
    if (this.failed.has(id)) {
      return;
    }

    this.log.info("start", { host, file });
    const type = this.ns.codingcontract.getContractType(file, host);
    const data = this.ns.codingcontract.getData(file, host);

    const solver = solvers[type];
    if (solver === undefined) {
      if (!this.complainedAboutMissing.has(type)) {
        this.complainedAboutMissing.add(type);
        this.log.terror("Unknown contract type", {
          type,
          host,
          file,
          desc: this.ns.codingcontract.getDescription(file, host),
          data,
        });
        this.log.error("Unknown contract type", { type, host, file });
      }
      return;
    }

    const answer = solver(data);
    const reward = this.ns.codingcontract.attempt(answer, file, host);

    if (reward === "") {
      this.failed.add(id);
      this.log.terror("Failed to solve", { host, file, type, data, answer });
      this.log.error("Failed to solve", { host, file, type, data, answer });
    } else {
      this.log.info("solved", { host, file, type, data, answer, reward });
      this.log.tinfo("solved", { host, file, type, data, answer, reward });
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const solvers: { [type: string]: (raw: unknown) => string | number | any[] } =
  {};
const tests: { [type: string]: { input: unknown; expected: unknown }[] } = {};

solvers["<BROKEN> Array Jumping Game II"] = (raw: unknown) => {
  const data = raw as number[];
  const jumpCounts = data.map(() => Infinity);
  jumpCounts[data.length - 1] = 0;

  for (let start = data.length - 2; start >= 0; start--) {
    const maxJump = start + data[start];
    let bestTarget = start;
    for (let target = start + 1; target <= maxJump; target++) {
      if (jumpCounts[target] < jumpCounts[bestTarget]) {
        bestTarget = target;
      }
    }
    if (bestTarget !== start && jumpCounts[bestTarget] !== Infinity) {
      jumpCounts[start] = jumpCounts[bestTarget] + 1;
    }
  }
  return jumpCounts[0];
};
tests["<BROKEN> Array Jumping Game II"] = [];

solvers["Proper 2-Coloring of a Graph"] = (raw: unknown) => {
  // The first element of the data represents the number of vertices in the
  // graph. Each vertex is a unique number between 0 and 7. The next element of
  // the data represents the edges of the graph. Two vertices u,v in a graph
  // are said to be adjacent if there exists an edge [u,v]. Note that an edge
  // [u,v] is the same as an edge [v,u], as order does not matter. You must
  // construct a 2-coloring of the graph, meaning that you have to assign each
  // vertex in the graph a "color", either 0 or 1, such that no two adjacent
  // vertices have the same color. Submit your answer in the form of an array,
  // where element i represents the color of vertex i. If it is impossible to
  // construct a 2-coloring of the given graph, instead submit an empty array.
  const data = raw as [number, [number, number][]];

  const n = data[0];
  const edges = data[1];

  const graph: number[][] = Array.from({ length: n }, () => []);
  for (const [u, v] of edges) {
    graph[u].push(v);
    graph[v].push(u);
  }

  const colors = Array.from({ length: n }, () => -1);
  const stack = [0];
  colors[0] = 0;

  while (stack.length > 0) {
    const u = stack.pop();
    if (u === undefined) {
      break;
    }
    for (const v of graph[u]) {
      if (colors[v] === -1) {
        colors[v] = 1 - colors[u];
        stack.push(v);
      } else if (colors[v] === colors[u]) {
        return [];
      }
    }
  }

  return colors;
};
tests["Proper 2-Coloring of a Graph"] = [
  {
    input: [
      4,
      [
        [0, 2],
        [0, 3],
        [1, 2],
        [1, 3],
      ],
    ],
    expected: [0, 0, 1, 1],
  },
  {
    input: [
      3,
      [
        [0, 1],
        [0, 2],
        [1, 2],
      ],
    ],
    expected: [],
  },
];

solvers["HammingCodes: Integer to Encoded Binary"] = (raw: unknown) => {
  /*
   Convert it to a binary representation and encode it as an 'extended Hamming code'. Eg:
  Value 8 is expressed in binary as '1000', which will be encoded with the pattern 'pppdpddd', where p is a parity bit and d a data bit. The encoding of
 8 is 11110000. As another example, '10101' (Value 21) will result into (pppdpdddpd) '1001101011'.
 The answer should be given as a string containing only 1s and 0s.
 NOTE: the endianness of the data bits is reversed in relation to the endianness of the parity bits.
 NOTE: The bit at index zero is the overall parity bit, this should be set last.
 NOTE 2: You should watch the Hamming Code video from 3Blue1Brown, which explains the 'rule' of encoding, including the first index parity bit mentioned in the previous note.

 Extra rule for encoding:
 There should be no leading zeros in the 'data bit' section
 */
  const data = raw as number;

  const binary = data.toString(2).split("").reverse();
  const parityBits = [0, 1, 3, 7];
  const result: number[] = Array.from({ length: 11 }, () => 0);

  for (let i = 0; i < binary.length; i++) {
    result[parityBits[i]] = parseInt(binary[i]);
  }

  for (let i = 0; i < binary.length; i++) {
    result[1 << i] = parseInt(binary[i]);
  }

  for (let i = 0; i < parityBits.length; i++) {
    result[0] ^= result[parityBits[i]];
  }

  return result.join("");
};
tests["HammingCodes: Integer to Encoded Binary"] = [
  { input: 8, expected: "11110000" },
  { input: 21, expected: "1001101011" },
];

function runTests(ns: NS) {
  const log = new Log(ns, "CodingContracts/test");

  let pass = 0;
  let fail = 0;

  for (const type in tests) {
    for (const { input, expected } of tests[type]) {
      const solver = solvers[type];
      if (solver === undefined) {
        log.terror("Unknown contract type", { type });
        continue;
      }

      const actual = solver(input);
      if (!deepEqual(actual, expected, { strict: true })) {
        log.terror("Test failed", { type, input, expected, actual });
        fail += 1;
      } else {
        log.tinfo("Test passed", { type, input, expected, actual });
        pass += 1;
      }
    }
  }

  log.tinfo("Tests complete", { pass, fail });
}

export async function main(ns: NS): Promise<void> {
  if (ns.args.includes("test")) {
    runTests(ns);
    return;
  }

  const codingContracts = new CodingContracts(ns);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await codingContracts.run();
    await ns.sleep(1000);
  }
}
