import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

const outputDirectory = mkdtempSync(join(tmpdir(), "run-tempo-export-tests-"));
const outputFile = join(outputDirectory, "exportWav.test.mjs");

try {
  await build({
    entryPoints: ["tests/exportWav.test.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: outputFile,
    sourcemap: "inline",
  });

  const result = spawnSync(process.execPath, ["--test", outputFile], {
    cwd: process.cwd(),
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
