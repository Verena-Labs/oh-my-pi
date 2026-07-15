#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parseMatrixDecisions, parseSelectedJourneys } from "./check-pi-product-docs.mjs";

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MANIFEST_PATH = join(REPOSITORY_ROOT, "scripts/fixtures/pi-phase4-evidence.json");
const MATRIX_PATH = join(REPOSITORY_ROOT, "OH_MY_PI_FEATURE_MATRIX.md");
const ACCEPTANCE_PATH = join(REPOSITORY_ROOT, "PI_ACCEPTANCE_TESTS.md");

const SURFACES = new Set([
  "command",
  "tool",
  "prompt",
  "help/completion",
  "setting",
  "discovery",
  "credential",
  "persistence",
  "lifecycle",
  "SDK/RPC",
  "packaging",
  "generated-document",
]);
const INSTRUMENTATION_CATEGORIES = new Set([
  "network",
  "credential",
  "filesystem",
  "child-process",
  "watcher",
  "timer",
  "persistent-store",
]);
const CONSUMER_OWNED_RELEASE_OBLIGATIONS = new Set([
  "artifact-verification",
  "installation",
  "packaging",
  "platform-support",
  "rollback",
  "updates",
]);

function sorted(values) {
  return [...values].map(String).sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function compareExact(actual, expected, label, diagnostics) {
  const actualSorted = sorted(actual);
  const expectedSorted = sorted(expected);
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    diagnostics.push(`${label} mismatch: expected ${expectedSorted.join(", ")}; got ${actualSorted.join(", ")}`);
  }
}

function validateTestList(entry, label, diagnostics, repositoryRoot) {
  if (!Array.isArray(entry?.tests) || entry.tests.length === 0) {
    diagnostics.push(`${label} must reference at least one test`);
    return;
  }
  if (new Set(entry.tests).size !== entry.tests.length) diagnostics.push(`${label} repeats a test path`);
  for (const test of entry.tests) {
    if (typeof test !== "string" || !test.endsWith(".test.ts")) {
      diagnostics.push(`${label} has invalid test path ${JSON.stringify(test)}`);
      continue;
    }
    if (!existsSync(join(repositoryRoot, test))) diagnostics.push(`${label} references missing ${test}`);
  }
}

export function validatePhase4Evidence({
  manifest,
  matrixMarkdown,
  acceptanceMarkdown,
  repositoryRoot = REPOSITORY_ROOT,
}) {
  const diagnostics = [];
  const matrix = parseMatrixDecisions(matrixMarkdown, { source: "OH_MY_PI_FEATURE_MATRIX.md" });
  const acceptance = parseSelectedJourneys(acceptanceMarkdown, { source: "PI_ACCEPTANCE_TESTS.md" });
  diagnostics.push(...matrix.diagnostics, ...acceptance.diagnostics);

  if (manifest?.schemaVersion !== 2) diagnostics.push("phase4 evidence schemaVersion must be 2");
  if (manifest?.sourceScope?.kind !== "source-only") {
    diagnostics.push("phase4 evidence sourceScope.kind must be source-only");
  }
  compareExact(
    manifest?.sourceScope?.consumerOwned ?? [],
    CONSUMER_OWNED_RELEASE_OBLIGATIONS,
    "consumer-owned release obligations",
    diagnostics,
  );

  const journeys = Array.isArray(manifest?.journeys) ? manifest.journeys : [];
  if (journeys.length !== 60) diagnostics.push(`phase4 evidence must contain 60 journeys; got ${journeys.length}`);
  const journeyNumbers = journeys.map((entry) => entry.journey);
  compareExact(journeyNumbers, Array.from({ length: 60 }, (_, index) => index + 1), "journey numbers", diagnostics);
  if (new Set(journeyNumbers).size !== journeyNumbers.length) diagnostics.push("phase4 evidence repeats a journey number");

  const acceptanceByJourney = new Map(acceptance.records.map((record) => [record.journey, record.id]));
  for (const entry of journeys) {
    if (acceptanceByJourney.get(entry.journey) !== entry.matrix) {
      diagnostics.push(
        `journey ${entry.journey} matrix mismatch: expected ${acceptanceByJourney.get(entry.journey) ?? "missing"}; got ${entry.matrix}`,
      );
    }
    validateTestList(entry, `journey ${entry.journey}`, diagnostics, repositoryRoot);
  }
  compareExact(
    journeys.map((entry) => entry.matrix),
    acceptance.records.map((record) => record.id),
    "selected journey matrix IDs",
    diagnostics,
  );

  const negatives = Array.isArray(manifest?.negative) ? manifest.negative : [];
  const expectedNegative = matrix.records.filter(({ decision }) => decision === "DISABLE" || decision === "ENABLE NARROWED");
  if (negatives.length !== 34) diagnostics.push(`phase4 evidence must contain 29 disabled and 5 narrowed negatives; got ${negatives.length}`);
  compareExact(
    negatives.map(({ matrix: id, decision }) => `${id}:${decision}`),
    expectedNegative.map(({ id, decision }) => `${id}:${decision}`),
    "negative matrix decisions",
    diagnostics,
  );
  const negativeKeys = negatives.map(({ matrix: id, decision }) => `${id}:${decision}`);
  if (new Set(negativeKeys).size !== negativeKeys.length) diagnostics.push("phase4 evidence repeats a negative matrix decision");
  for (const entry of negatives) validateTestList(entry, `negative ${entry.matrix}`, diagnostics, repositoryRoot);

  if (matrix.records.length !== 89) diagnostics.push(`matrix must classify 89 decisions; got ${matrix.records.length}`);
  const classified = new Set([...journeys.map((entry) => entry.matrix), ...negatives.map((entry) => entry.matrix)]);
  compareExact(classified, matrix.records.map(({ id }) => id), "all classified matrix IDs", diagnostics);

  const surfaces = Array.isArray(manifest?.surfaces) ? manifest.surfaces : [];
  compareExact(surfaces.map(({ name }) => name), SURFACES, "surface classes", diagnostics);
  if (new Set(surfaces.map(({ name }) => name)).size !== surfaces.length) diagnostics.push("phase4 evidence repeats a surface class");
  for (const entry of surfaces) validateTestList(entry, `surface ${entry.name}`, diagnostics, repositoryRoot);

  const instrumentation = Array.isArray(manifest?.instrumentation) ? manifest.instrumentation : [];
  if (instrumentation.length !== 1 || instrumentation[0]?.name !== "startup-idle") {
    diagnostics.push("phase4 evidence must contain one startup-idle instrumentation obligation");
  } else {
    compareExact(
      instrumentation[0].categories ?? [],
      INSTRUMENTATION_CATEGORIES,
      "startup-idle instrumentation categories",
      diagnostics,
    );
    validateTestList(instrumentation[0], "startup-idle instrumentation", diagnostics, repositoryRoot);
  }

  const canary = manifest?.canaryEvidence;
  if (canary?.journey !== 1 || canary?.matrix !== "01" || canary?.kind !== "real-model-pty") {
    diagnostics.push("journey 1 must record the completed real-model PTY canary");
  }

  return {
    diagnostics,
    counts: {
      matrix: matrix.records.length,
      journeys: journeys.length,
      disabled: negatives.filter(({ decision }) => decision === "DISABLE").length,
      narrowed: negatives.filter(({ decision }) => decision === "ENABLE NARROWED").length,
      surfaces: surfaces.length,
      instrumentation: instrumentation.length,
    },
  };
}

function sanitizedTestEnvironment(home) {
  const env = { ...process.env };
  const credentialPattern = /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?|AUTH)(?:_|$)/iu;
  for (const key of Object.keys(env)) {
    if (credentialPattern.test(key) || /^(?:AWS|AZURE|GOOGLE|OPENAI|ANTHROPIC|GITHUB|GH|KAGI|PARALLEL)_/u.test(key)) {
      delete env[key];
    }
  }
  Object.assign(env, {
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local/share"),
    XDG_STATE_HOME: join(home, ".local/state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    NODE_ENV: "test",
    CI: "1",
    NO_COLOR: "1",
  });
  for (const key of ["OMP_PROFILE", "PI_PROFILE", "PI_CODING_AGENT_DIR", "PI_CONFIG_DIR", "OMP_HOME", "PI_HOME"]) {
    delete env[key];
  }
  return env;
}

async function runTests(entries, label) {
  const tests = sorted(new Set(entries.flatMap((entry) => entry.tests)));
  const isolated = await mkdtemp(join(tmpdir(), `pi-phase4-${label}-`));
  await Promise.all([
    mkdir(join(isolated, ".config"), { recursive: true }),
    mkdir(join(isolated, ".local/share"), { recursive: true }),
    mkdir(join(isolated, ".local/state"), { recursive: true }),
    mkdir(join(isolated, ".cache"), { recursive: true }),
  ]);
  const chunks = [];
  for (let index = 0; index < tests.length; index += 8) chunks.push(tests.slice(index, index + 8));
  const failedChunks = [];
  try {
    for (const [index, chunk] of chunks.entries()) {
      process.stdout.write(`\n[phase4:${label}] chunk ${index + 1}/${chunks.length}: ${chunk.length} test files\n`);
      const result = spawnSync(
        process.env.BUN_BIN || "bun",
        ["test", "--parallel=1", "--max-concurrency=1", "--timeout=30000", "--only-failures", ...chunk],
        { cwd: REPOSITORY_ROOT, env: sanitizedTestEnvironment(isolated), stdio: "inherit" },
      );
      if (result.error) throw result.error;
      if (result.status !== 0) failedChunks.push({ chunk: index + 1, status: result.status });
    }
  } finally {
    await rm(isolated, { recursive: true, force: true });
  }
  if (failedChunks.length > 0) {
    throw new Error(
      `${label} evidence failed in ${failedChunks.map(({ chunk, status }) => `chunk ${chunk} (status ${status})`).join(", ")}`,
    );
  }
  process.stdout.write(`\n[phase4:${label}] PASS: ${entries.length} obligations mapped to ${tests.length} passing test files\n`);
}

async function main() {
  const [manifestText, matrixMarkdown, acceptanceMarkdown] = await Promise.all([
    readFile(MANIFEST_PATH, "utf8"),
    readFile(MATRIX_PATH, "utf8"),
    readFile(ACCEPTANCE_PATH, "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  const result = validatePhase4Evidence({ manifest, matrixMarkdown, acceptanceMarkdown });
  if (result.diagnostics.length > 0) {
    for (const diagnostic of result.diagnostics) process.stderr.write(`phase4 evidence: ${diagnostic}\n`);
    process.exitCode = 1;
    return;
  }
  const { matrix, journeys, disabled, narrowed, surfaces, instrumentation } = result.counts;
  process.stdout.write(
    `Phase 4 evidence manifest valid: ${matrix} decisions, ${journeys} journeys, ${disabled} disabled, ${narrowed} narrowed negatives, ${surfaces} surface classes, ${instrumentation} startup/idle instrumentation obligation.\n`,
  );

  const mode = process.argv.find((argument) => argument.startsWith("--run="))?.slice("--run=".length);
  if (!mode) return;
  if (!["journeys", "negative", "surfaces", "instrumentation", "all"].includes(mode)) {
    throw new Error(`unknown --run mode ${JSON.stringify(mode)}`);
  }
  if (mode === "journeys" || mode === "all") await runTests(manifest.journeys, "journeys");
  if (mode === "negative" || mode === "all") await runTests(manifest.negative, "negative");
  if (mode === "surfaces" || mode === "all") await runTests(manifest.surfaces, "surfaces");
  if (mode === "instrumentation" || mode === "all") await runTests(manifest.instrumentation, "instrumentation");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
