const esbuild = require("esbuild");
const chokidar = require("chokidar");
const path = require("path");

const { src, dist } = require("./config");

async function rebuild(file) {
  const relative = path.relative(src, file);
  const distFile = path.resolve(dist, relative).replace(/\.ts$/, ".js");
  console.log(`Rebuilding ${relative}...`);
  try {
    await esbuild
      .build({
        entryPoints: [file],
        bundle: true,
        minify: false,
        sourcemap: "inline",
        outfile: distFile,
        format: "esm",
        watch: {
          onRebuild(error) {
            if (error) console.error("watch build failed:", error);
            else console.log("watch build succeeded: " + file);
          },
        },
        watch: true,
        incremental: true,
      })
      .then(() => {
        console.log("Started watching " + file);
      });
  } catch (e) {
    console.error(e);
  }
}

chokidar.watch(`${src}/bin/**/*.ts`, { persistent: true }).on("add", rebuild);
