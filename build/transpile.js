const esbuild = require("esbuild");
const chokidar = require("chokidar");
const path = require("path");

const { src, dist } = require("./config");

async function rebuild(file) {
  const relative = path.relative(src, file);
  const distFile = path.resolve(dist, relative).replace(/\.ts$/, ".js");
  console.log(`Rebuilding ${relative}...`);
  await esbuild.build({
    entryPoints: [file],
    bundle: true,
    minify: false,
    sourcemap: "inline",
    outfile: distFile,
    format: "esm",
  });
}

chokidar
  .watch(`${src}/bin/**/*.ts`, { persistent: true })
  .on("add", rebuild)
  .on("change", rebuild);
