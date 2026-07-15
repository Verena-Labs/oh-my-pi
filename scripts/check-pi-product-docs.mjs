#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FEATURE_ID_PATTERN = /^(?:0[1-9]|[1-9]\d)[a-z]?$/u;
const MATRIX_HEADER = "ID — Oh My Pi addition";
const DECISIONS = new Set([
  "ENABLE",
  "ENABLE NARROWED",
  "DISABLE",
  "BASELINE ONLY",
]);
const SELECTED_DECISIONS = new Set(["ENABLE", "ENABLE NARROWED"]);
const SELECTED_HEADING = "Selected capability journeys";

function splitMarkdownTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;

  const body = trimmed.endsWith("|") ? trimmed.slice(1, -1) : trimmed.slice(1);
  const cells = [];
  let cell = "";

  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === "\\" && body[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (body[index] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += body[index];
    }
  }

  cells.push(cell.trim());
  return cells;
}

function isTableSeparator(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell.replaceAll(" ", "")));
}

function compareFeatureIds(left, right) {
  const leftMatch = /^(\d{2})([a-z]?)$/u.exec(left);
  const rightMatch = /^(\d{2})([a-z]?)$/u.exec(right);
  if (!leftMatch || !rightMatch) return left.localeCompare(right);
  return Number(leftMatch[1]) - Number(rightMatch[1]) || leftMatch[2].localeCompare(rightMatch[2]);
}

export function parseMatrixDecisions(markdown, { source = "matrix" } = {}) {
  const lines = markdown.split(/\r?\n/u);
  const records = [];
  const diagnostics = [];
  const firstDeclaration = new Map();
  let tableCount = 0;
  let inFeatureTable = false;

  for (let index = 0; index < lines.length; index += 1) {
    const cells = splitMarkdownTableRow(lines[index]);

    if (!inFeatureTable) {
      if (cells?.[1] === MATRIX_HEADER) {
        tableCount += 1;
        inFeatureTable = true;
      }
      continue;
    }

    if (!cells) {
      inFeatureTable = false;
      continue;
    }
    if (isTableSeparator(cells)) continue;

    const line = index + 1;
    const idMatch = /^(\S+)\s+—\s+\S.*$/u.exec(cells[1] ?? "");
    const id = idMatch?.[1] ?? "";
    if (!FEATURE_ID_PATTERN.test(id)) {
      diagnostics.push(`${source}:${line}: malformed matrix feature ID ${JSON.stringify(id)}`);
      continue;
    }

    const decisionMatch = /^(ENABLE NARROWED|ENABLE|DISABLE|BASELINE ONLY)\s+—\s+/u.exec(cells[0] ?? "");
    const decision = decisionMatch?.[1] ?? "";
    if (!DECISIONS.has(decision)) {
      diagnostics.push(`${source}:${line}: feature ${id} has no valid leading capability decision`);
      continue;
    }

    const firstLine = firstDeclaration.get(id);
    if (firstLine !== undefined) {
      diagnostics.push(`${source}:${line}: duplicate feature ${id}; first declared on line ${firstLine}`);
      continue;
    }

    firstDeclaration.set(id, line);
    records.push({ id, decision, line });
  }

  if (tableCount === 0) diagnostics.push(`${source}: no feature matrix tables found`);
  return { records, diagnostics, tableCount };
}

export function parseSelectedJourneys(markdown, { source = "acceptance" } = {}) {
  const lines = markdown.split(/\r?\n/u);
  const records = [];
  const diagnostics = [];
  const firstReference = new Map();
  let headingLine = -1;
  let inTable = false;

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === `## ${SELECTED_HEADING}`) {
      headingLine = index;
      break;
    }
  }

  if (headingLine === -1) {
    return {
      records,
      diagnostics: [`${source}: missing ${JSON.stringify(SELECTED_HEADING)} section`],
    };
  }

  for (let index = headingLine + 1; index < lines.length; index += 1) {
    if (/^##\s+/u.test(lines[index])) break;
    const cells = splitMarkdownTableRow(lines[index]);

    if (!inTable) {
      if (cells?.[0] === "#" && cells?.[1] === "Matrix") inTable = true;
      continue;
    }

    if (!cells) {
      if (records.length > 0) break;
      continue;
    }
    if (isTableSeparator(cells)) continue;

    const line = index + 1;
    const journey = Number(cells[0]);
    const id = cells[1] ?? "";
    if (!Number.isInteger(journey) || journey !== records.length + 1) {
      diagnostics.push(`${source}:${line}: journey number must be ${records.length + 1}`);
    }
    if (!FEATURE_ID_PATTERN.test(id)) {
      diagnostics.push(`${source}:${line}: malformed selected matrix reference ${JSON.stringify(id)}`);
      continue;
    }

    const firstLine = firstReference.get(id);
    if (firstLine !== undefined) {
      diagnostics.push(`${source}:${line}: duplicate selected reference ${id}; first declared on line ${firstLine}`);
      continue;
    }

    firstReference.set(id, line);
    records.push({ id, journey, line });
  }

  if (!inTable) diagnostics.push(`${source}: selected capability journey table not found`);
  if (inTable && records.length === 0) diagnostics.push(`${source}: selected capability journey table is empty`);
  return { records, diagnostics };
}

export function checkProductDocs({ matrixMarkdown, acceptanceMarkdown }) {
  const matrix = parseMatrixDecisions(matrixMarkdown, { source: "OH_MY_PI_FEATURE_MATRIX.md" });
  const acceptance = parseSelectedJourneys(acceptanceMarkdown, { source: "PI_ACCEPTANCE_TESTS.md" });
  const diagnostics = [...matrix.diagnostics, ...acceptance.diagnostics];
  const selectedMatrixIds = matrix.records
    .filter((record) => SELECTED_DECISIONS.has(record.decision))
    .map((record) => record.id)
    .sort(compareFeatureIds);
  const acceptanceIds = acceptance.records.map((record) => record.id).sort(compareFeatureIds);
  const selectedSet = new Set(selectedMatrixIds);
  const acceptanceSet = new Set(acceptanceIds);
  const missing = selectedMatrixIds.filter((id) => !acceptanceSet.has(id));
  const unexpected = acceptanceIds.filter((id) => !selectedSet.has(id));

  if (missing.length > 0) {
    diagnostics.push(`PI_ACCEPTANCE_TESTS.md: missing selected matrix IDs: ${missing.join(", ")}`);
  }
  if (unexpected.length > 0) {
    diagnostics.push(`PI_ACCEPTANCE_TESTS.md: journeys reference non-selected matrix IDs: ${unexpected.join(", ")}`);
  }

  return { ok: diagnostics.length === 0, diagnostics, matrix, acceptance };
}

function displayPath(path, cwd) {
  const local = relative(cwd, path);
  return local && !local.startsWith("..") ? local : path;
}

export async function runCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const matrixPath = resolve(cwd, argv[0] ?? resolve(repositoryRoot, "OH_MY_PI_FEATURE_MATRIX.md"));
  const acceptancePath = resolve(cwd, argv[1] ?? resolve(repositoryRoot, "PI_ACCEPTANCE_TESTS.md"));
  let matrixMarkdown;
  let acceptanceMarkdown;

  try {
    [matrixMarkdown, acceptanceMarkdown] = await Promise.all([
      readFile(matrixPath, "utf8"),
      readFile(acceptancePath, "utf8"),
    ]);
  } catch (error) {
    stderr.write(`product-docs: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  const result = checkProductDocs({ matrixMarkdown, acceptanceMarkdown });
  if (!result.ok) {
    stderr.write(`product docs failed (${result.diagnostics.length})\n`);
    for (const diagnostic of result.diagnostics) stderr.write(`- ${diagnostic}\n`);
    return 1;
  }

  stdout.write(
    `product docs ok: ${result.matrix.records.length} matrix decisions; ${result.acceptance.records.length} selected journeys (${displayPath(matrixPath, cwd)} -> ${displayPath(acceptancePath, cwd)})\n`,
  );
  return 0;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = await runCli();
