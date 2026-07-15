#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPOSITORY_ROOT = resolve(SCRIPT_DIR, "..");
export const CONFIG_PATH = "automation/upstream-sync.json";
export const PROVENANCE_PATH = "PI_VENDOR.md";

const UPSTREAM_TAG_PATTERN = /^v(\d+\.\d+\.\d+)$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const EVIDENCE_COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;

function invariant(value, message) {
	if (!value) {
		throw new Error(message);
	}
}

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function deriveReleaseTag(upstreamTag, revision) {
	invariant(UPSTREAM_TAG_PATTERN.test(upstreamTag), `Invalid upstream tag: ${upstreamTag}`);
	invariant(Number.isInteger(revision) && revision > 0, `Invalid downstream revision: ${revision}`);
	return `pi-${upstreamTag}-r${revision}`;
}

export function validateConfig(config) {
	invariant(isObject(config), "Upstream sync configuration must be an object");
	invariant(config.schemaVersion === 1, "schemaVersion must be 1");
	invariant(config.downstreamRepository === "Verena-Labs/oh-my-pi", "Unexpected downstreamRepository");
	invariant(config.integrationBranch === "main", "The only released integration branch must be main");

	invariant(isObject(config.upstream), "upstream must be an object");
	invariant(config.upstream.repository === "can1357/oh-my-pi", "Unexpected upstream repository");
	invariant(config.upstream.url === "https://github.com/can1357/oh-my-pi.git", "Unexpected upstream URL");
	invariant(UPSTREAM_TAG_PATTERN.test(config.upstream.tag), `Invalid upstream tag: ${config.upstream.tag}`);
	invariant(COMMIT_PATTERN.test(config.upstream.commit), "upstream.commit must be a lowercase 40-hex commit");

	invariant(isObject(config.sync), "sync must be an object");
	invariant(config.sync.branchPrefix === "sync/upstream-v", "Sync branches must use sync/upstream-v*");
	invariant(config.sync.strategy === "merge-exact-upstream-tag", "Upstream updates must merge an exact tag");
	invariant(config.sync.history === "merge-commit", "Upstream updates must preserve a merge commit");

	invariant(isObject(config.release), "release must be an object");
	invariant(Number.isInteger(config.release.revision) && config.release.revision > 0, "Invalid release revision");
	invariant(
		config.release.tag === deriveReleaseTag(config.upstream.tag, config.release.revision),
		"release.tag does not match the recorded upstream and revision",
	);
	invariant(config.release.tagPattern === "pi-v<upstream>-r<revision>", "Unexpected release tag pattern");
	invariant(config.release.sourceOnly === true, "Downstream releases must be source-only");
	invariant(config.release.mutable === false, "Downstream release tags must be immutable");
	invariant(Array.isArray(config.release.publishes) && config.release.publishes.length === 0, "Publishing is forbidden");

	invariant(isObject(config.baselineEvidence), "baselineEvidence must be an object");
	invariant(config.baselineEvidence.sourceRepository === "hachoj/pi-dotfiles", "Unexpected baseline source repository");
	invariant(EVIDENCE_COMMIT_PATTERN.test(config.baselineEvidence.sourceCommit), "Invalid baseline source commit");
	invariant(EVIDENCE_COMMIT_PATTERN.test(config.baselineEvidence.forkBaselineCommit), "Invalid fork baseline commit");
	return config;
}

export function renderProvenance(config) {
	validateConfig(config);
	return `# Downstream provenance

This file is generated from \`${CONFIG_PATH}\` by \`scripts/upstream-sync.mjs\`. Do not edit it directly.

- Downstream repository: \`${config.downstreamRepository}\`
- Released integration branch: \`${config.integrationBranch}\`
- Current upstream repository: \`${config.upstream.repository}\`
- Current upstream release: \`${config.upstream.tag}\`
- Exact upstream commit: \`${config.upstream.commit}\`
- Current downstream source tag: \`${config.release.tag}\`
- Publication boundary: immutable source tag only; no packages or binary artifacts

## Initial baseline evidence

- Accepted source tree: \`${config.baselineEvidence.sourceRepository}@${config.baselineEvidence.sourceCommit}\`
- One-commit fork baseline: \`${config.baselineEvidence.forkBaselineCommit}\`

This baseline evidence explains the one-time fork import. Future upstream updates merge exact upstream tags with merge
commits under the policy in \`PI_FORK.md\`; they do not replay the original pi-dotfiles patch stack.
`;
}

export function computeRecordedConfig(config, { upstreamTag, upstreamCommit, revision }) {
	validateConfig(config);
	invariant(UPSTREAM_TAG_PATTERN.test(upstreamTag), `Invalid upstream tag: ${upstreamTag}`);
	invariant(COMMIT_PATTERN.test(upstreamCommit), "--upstream-commit must be a lowercase 40-hex commit");
	if (upstreamTag === config.upstream.tag && upstreamCommit !== config.upstream.commit) {
		throw new Error(`Upstream tag ${upstreamTag} is already recorded with a different commit`);
	}

	const expectedRevision = upstreamTag === config.upstream.tag ? config.release.revision + 1 : 1;
	if (revision !== undefined) {
		invariant(Number.isInteger(revision) && revision > 0, "--revision must be a positive integer");
		invariant(revision === expectedRevision, `Expected revision ${expectedRevision} for ${upstreamTag}, received ${revision}`);
	}

	const next = structuredClone(config);
	next.upstream.tag = upstreamTag;
	next.upstream.commit = upstreamCommit;
	next.release.revision = revision ?? expectedRevision;
	next.release.tag = deriveReleaseTag(upstreamTag, next.release.revision);
	return validateConfig(next);
}

function readConfig(repositoryRoot) {
	const path = join(repositoryRoot, CONFIG_PATH);
	return validateConfig(JSON.parse(readFileSync(path, "utf8")));
}

function runGit(repositoryRoot, args) {
	return spawnSync("git", args, { cwd: repositoryRoot, encoding: "utf8" });
}

function resolveGitCommit(repositoryRoot, ref) {
	return execFileSync("git", ["rev-parse", `${ref}^{commit}`], {
		cwd: repositoryRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

export function verifyRecordedHistory(repositoryRoot, config) {
	validateConfig(config);
	const objectCheck = runGit(repositoryRoot, ["cat-file", "-e", `${config.upstream.commit}^{commit}`]);
	invariant(objectCheck.status === 0, `Recorded upstream commit is not present locally: ${config.upstream.commit}`);
	const ancestryCheck = runGit(repositoryRoot, ["merge-base", "--is-ancestor", config.upstream.commit, "HEAD"]);
	invariant(ancestryCheck.status === 0, `Recorded upstream commit is not an ancestor of HEAD: ${config.upstream.commit}`);

	const upstreamRef = `refs/tags/${config.upstream.tag}`;
	const upstreamTagCheck = runGit(repositoryRoot, ["show-ref", "--verify", "--quiet", upstreamRef]);
	if (upstreamTagCheck.status === 0) {
		invariant(
			resolveGitCommit(repositoryRoot, upstreamRef) === config.upstream.commit,
			`Recorded upstream tag does not resolve to ${config.upstream.commit}: ${config.upstream.tag}`,
		);
	}

	const releaseRef = `refs/tags/${config.release.tag}`;
	const releaseTagCheck = runGit(repositoryRoot, ["show-ref", "--verify", "--quiet", releaseRef]);
	if (releaseTagCheck.status === 0) {
		const releaseObjectType = execFileSync("git", ["cat-file", "-t", releaseRef], {
			cwd: repositoryRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
		invariant(releaseObjectType === "tag", `Recorded release must be an annotated tag: ${config.release.tag}`);
		const releaseCommit = resolveGitCommit(repositoryRoot, releaseRef);
		const releaseAncestry = runGit(repositoryRoot, ["merge-base", "--is-ancestor", releaseCommit, "HEAD"]);
		invariant(releaseAncestry.status === 0, `Recorded release tag is not an ancestor of HEAD: ${config.release.tag}`);
	}
}

export function checkRepository({ repositoryRoot = DEFAULT_REPOSITORY_ROOT, verifyHistory = true } = {}) {
	const config = readConfig(repositoryRoot);
	const provenance = readFileSync(join(repositoryRoot, PROVENANCE_PATH), "utf8");
	invariant(provenance === renderProvenance(config), `${PROVENANCE_PATH} is stale; run the record command`);
	if (verifyHistory) {
		verifyRecordedHistory(repositoryRoot, config);
	}
	return config;
}

function writeAtomically(path, contents) {
	const temporaryPath = `${path}.tmp`;
	writeFileSync(temporaryPath, contents, "utf8");
	renameSync(temporaryPath, path);
}

export function recordRepository({
	repositoryRoot = DEFAULT_REPOSITORY_ROOT,
	upstreamTag,
	upstreamCommit,
	revision,
	dryRun = false,
	verifyHistory = true,
}) {
	const current = readConfig(repositoryRoot);
	const next = computeRecordedConfig(current, { upstreamTag, upstreamCommit, revision });
	if (verifyHistory) {
		verifyRecordedHistory(repositoryRoot, next);
	}
	if (!dryRun) {
		writeAtomically(join(repositoryRoot, CONFIG_PATH), `${JSON.stringify(next, null, "\t")}\n`);
		writeAtomically(join(repositoryRoot, PROVENANCE_PATH), renderProvenance(next));
	}
	return next;
}

function usage() {
	return `Usage:
  node scripts/upstream-sync.mjs check [--repo <path>]
  node scripts/upstream-sync.mjs record --upstream-tag vX.Y.Z --upstream-commit <40-hex> [--revision N] [--dry-run] [--repo <path>]
`;
}

function parseArguments(argv) {
	const [command, ...rest] = argv;
	const options = { command, repositoryRoot: DEFAULT_REPOSITORY_ROOT, dryRun: false };
	for (let index = 0; index < rest.length; index += 1) {
		const argument = rest[index];
		if (argument === "--dry-run") {
			options.dryRun = true;
			continue;
		}
		const value = rest[index + 1];
		invariant(value !== undefined, `Missing value for ${argument}`);
		index += 1;
		switch (argument) {
			case "--repo":
				options.repositoryRoot = resolve(value);
				break;
			case "--upstream-tag":
				options.upstreamTag = value;
				break;
			case "--upstream-commit":
				options.upstreamCommit = value;
				break;
			case "--revision":
				options.revision = Number(value);
				break;
			default:
				throw new Error(`Unknown argument: ${argument}`);
		}
	}
	return options;
}

function main(argv) {
	const options = parseArguments(argv);
	if (options.command === "check") {
		invariant(!options.dryRun, "--dry-run is only valid with record");
		const config = checkRepository({ repositoryRoot: options.repositoryRoot });
		process.stdout.write(`Verified ${config.release.tag} against ${config.upstream.tag}@${config.upstream.commit}\n`);
		return;
	}
	if (options.command === "record") {
		invariant(options.upstreamTag, "record requires --upstream-tag");
		invariant(options.upstreamCommit, "record requires --upstream-commit");
		const config = recordRepository(options);
		process.stdout.write(
			`${options.dryRun ? "Would record" : "Recorded"} ${config.release.tag} against ${config.upstream.tag}@${config.upstream.commit}\n`,
		);
		return;
	}
	process.stderr.write(usage());
	process.exitCode = options.command === "help" || options.command === "--help" ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(`upstream-sync: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
