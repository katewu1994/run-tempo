import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { build } from "esbuild";

const outputDirectory = mkdtempSync(join(tmpdir(), "run-tempo-multi-tests-"));
const testFiles = [
  "tests/multiTrackLibrary.test.ts",
  "tests/multiTrackAnalysisQueue.test.ts",
];

try {
  for (const testFile of testFiles) {
    const outputFile = join(
      outputDirectory,
      basename(testFile).replace(/\.ts$/, ".mjs"),
    );
    await build({
      entryPoints: [testFile],
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

    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
