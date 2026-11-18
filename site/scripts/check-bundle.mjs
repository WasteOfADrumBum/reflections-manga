// Build check for the serverless function: bundles api/studio.ts the way a
// Node runtime would load it and fails on unresolved imports or syntax errors.
// The public site has no build step; this covers the only compiled code.
import { build } from "esbuild";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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
