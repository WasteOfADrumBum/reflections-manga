// Build checks for the serverless function, the only compiled code (the public
// site has no build step).
//
// 1. Bundle api/studio.ts with esbuild: fails on unresolved imports, syntax
//    errors or test-only code leaking into production.
// 2. Load it the way Vercel's Node runtime does: compile every file on its own
//    (no bundling, import paths kept as written) and import the compiled
//    entry with plain Node. This catches import paths that only a bundler or
//    test runner can resolve, such as "./x.ts" specifiers.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const out = await mkdtemp(path.join(tmpdir(), "studio-bundle-"));
try {
  const result = await build({
    entryPoints: ["api/studio.ts"],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outfile: path.join(out, "studio.mjs"),
    external: ["sharp", "pg-native"],
    logLevel: "warning",
    metafile: true,
  });
  const size = (await stat(path.join(out, "studio.mjs"))).size;
  const inputs = Object.keys(result.metafile.inputs);
  if (inputs.some((i) => i.includes("tests/") || i.includes("pglite"))) throw new Error("Test-only code leaked into the production bundle.");
  console.log(`api/studio.ts bundles cleanly (${(size / 1024 / 1024).toFixed(2)} MB, ${inputs.length} modules).`);
} finally {
  await rm(out, { recursive: true, force: true });
}

// Per-file compile inside site/ so node_modules resolve as they do on Vercel.
const emitDir = ".function-check";
await rm(emitDir, { recursive: true, force: true });
try {
  execFileSync(
    process.execPath,
    [
      "node_modules/typescript/bin/tsc",
      "-p", "tsconfig.json",
      "--noEmit", "false",
      "--outDir", emitDir,
      "--rootDir", ".",
      "--declaration", "false",
      "--sourceMap", "false",
    ],
    { stdio: "inherit" },
  );
  const mod = await import(pathToFileURL(path.resolve(emitDir, "api/studio.js")).href);
  if (typeof mod.default !== "function" && typeof mod.GET !== "function" && typeof mod.POST !== "function") {
    throw new Error("api/studio.js loaded but exports no request handler.");
  }
  console.log("api/studio.ts loads with plain Node after a per-file compile, as on Vercel.");
} finally {
  await rm(emitDir, { recursive: true, force: true });
}
