import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validatePhase4Evidence } from "./check-pi-phase4-evidence.mjs";

const [manifestText, matrixMarkdown, acceptanceMarkdown] = await Promise.all([
  readFile(new URL("./fixtures/pi-phase4-evidence.json", import.meta.url), "utf8"),
  readFile(new URL("../OH_MY_PI_FEATURE_MATRIX.md", import.meta.url), "utf8"),
  readFile(new URL("../PI_ACCEPTANCE_TESTS.md", import.meta.url), "utf8"),
]);

test("Phase 4 manifest proves every selected, disabled, narrowed, and surface obligation", () => {
  const result = validatePhase4Evidence({
    manifest: JSON.parse(manifestText),
    matrixMarkdown,
    acceptanceMarkdown,
  });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.counts, {
    matrix: 89,
    journeys: 60,
    disabled: 29,
    narrowed: 5,
    surfaces: 12,
    instrumentation: 1,
  });
});

test("Phase 4 manifest rejects a selected journey mapped to the wrong matrix row", () => {
  const manifest = JSON.parse(manifestText);
  manifest.journeys[0].matrix = "02";
  const result = validatePhase4Evidence({ manifest, matrixMarkdown, acceptanceMarkdown });
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes("journey 1 matrix mismatch")));
});

test("Phase 4 manifest rejects moving consumer release obligations into source scope", () => {
  const manifest = JSON.parse(manifestText);
  manifest.sourceScope.kind = "darwin-arm64-release";
  manifest.sourceScope.consumerOwned = manifest.sourceScope.consumerOwned.filter(
    (obligation) => obligation !== "platform-support",
  );
  const result = validatePhase4Evidence({ manifest, matrixMarkdown, acceptanceMarkdown });
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes("sourceScope.kind must be source-only")));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes("consumer-owned release obligations mismatch")));
});
