import { nodeResolve } from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";

const binaries = [
  "simple-hack",
  "test",
  "supervisor",
  "supervisorctl",
  "payloads/sleep",
];

export default binaries.map((binary) => ({
  input: `src/bin/${binary}.ts`,
  output: {
    dir: "dist",
  },
  plugins: [nodeResolve(), typescript(), commonjs()],
}));
