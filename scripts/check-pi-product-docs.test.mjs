import assert from "node:assert/strict";
import test from "node:test";

import {
  checkProductDocs,
  parseMatrixDecisions,
  parseSelectedJourneys,
} from "./check-pi-product-docs.mjs";

const matrix = `
| Notes | ID — Oh My Pi addition | Codex | Claude Code |
|---|---|---:|---:|
| ENABLE — Keep it. | 01 — One | - | - |
| ENABLE NARROWED — Keep part. | 02 — Two | - | - |
| DISABLE — Omit it. | 03 — Three | - | - |
| BASELINE ONLY — Keep baseline. | 04 — Four | - | - |
`;

const acceptance = `
## Selected capability journeys

| # | Matrix | Observable pass condition | Prerequisites and boundaries |
|---:|:---:|---|---|
| 1 | 01 | One works. | Fixture. |
| 2 | 02 | Two works. | Fixture. |

## Negative-surface and inertness contract
`;

test("parses one explicit decision per matrix row", () => {
  const result = parseMatrixDecisions(matrix);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.records.map(({ id, decision }) => ({ id, decision })), [
    { id: "01", decision: "ENABLE" },
    { id: "02", decision: "ENABLE NARROWED" },
    { id: "03", decision: "DISABLE" },
    { id: "04", decision: "BASELINE ONLY" },
  ]);
});

test("parses ordered selected journeys", () => {
  const result = parseSelectedJourneys(acceptance);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.records.map(({ id }) => id), ["01", "02"]);
});

test("accepts exact selected matrix coverage", () => {
  const result = checkProductDocs({ matrixMarkdown: matrix, acceptanceMarkdown: acceptance });
  assert.equal(result.ok, true);
  assert.deepEqual(result.diagnostics, []);
});

test("rejects missing and non-selected journey references", () => {
  const mismatched = acceptance
    .replace("| 2 | 02 | Two works. | Fixture. |", "| 2 | 03 | Three works. | Fixture. |");
  const result = checkProductDocs({ matrixMarkdown: matrix, acceptanceMarkdown: mismatched });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes("missing selected matrix IDs: 02")));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes("non-selected matrix IDs: 03")));
});

test("rejects a matrix row without a valid leading decision", () => {
  const invalid = matrix.replace("DISABLE — Omit it.", "MAYBE — Omit it.");
  const result = parseMatrixDecisions(invalid);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.includes("feature 03 has no valid")));
});
