import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	checkRepository,
	computeRecordedConfig,
	deriveReleaseTag,
	recordRepository,
	renderProvenance,
	validateConfig,
} from "./upstream-sync.mjs";

function initialConfig() {
	return {
		schemaVersion: 1,
		downstreamRepository: "Verena-Labs/oh-my-pi",
		integrationBranch: "main",
		upstream: {
			repository: "can1357/oh-my-pi",
			url: "https://github.com/can1357/oh-my-pi.git",
			tag: "v16.5.0",
			commit: "3047c27c332c5629c8e063283d349384c10c9a56",
		},
		sync: {
			branchPrefix: "sync/upstream-v",
			strategy: "merge-exact-upstream-tag",
			history: "merge-commit",
		},
		release: {
			tag: "pi-v16.5.0-r1",
			revision: 1,
			tagPattern: "pi-v<upstream>-r<revision>",
			sourceOnly: true,
			mutable: false,
			publishes: [],
		},
		baselineEvidence: {
			sourceRepository: "hachoj/pi-dotfiles",
			sourceCommit: "14829aa",
			forkBaselineCommit: "cb60845d8",
		},
	};
}

function fixtureRepository(config = initialConfig()) {
	const repositoryRoot = mkdtempSync(join(tmpdir(), "upstream-sync-"));
	mkdirSync(join(repositoryRoot, "automation"));
	writeFileSync(join(repositoryRoot, "automation/upstream-sync.json"), `${JSON.stringify(config, null, "\t")}\n`);
	writeFileSync(join(repositoryRoot, "PI_VENDOR.md"), renderProvenance(config));
	return repositoryRoot;
}

function git(repositoryRoot, ...args) {
	return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

test("derives the immutable source tag convention", () => {
	assert.equal(deriveReleaseTag("v16.5.0", 1), "pi-v16.5.0-r1");
	assert.equal(deriveReleaseTag("v16.5.0", 3), "pi-v16.5.0-r3");
});

test("rejects mutable or publishing release records", () => {
	const mutable = initialConfig();
	mutable.release.mutable = true;
	assert.throws(() => validateConfig(mutable), /immutable/);

	const publishing = initialConfig();
	publishing.release.publishes = ["npm"];
	assert.throws(() => validateConfig(publishing), /Publishing is forbidden/);
});

test("increments a downstream-only revision deterministically", () => {
	const current = initialConfig();
	const next = computeRecordedConfig(current, {
		upstreamTag: current.upstream.tag,
		upstreamCommit: current.upstream.commit,
	});
	assert.equal(next.release.revision, 2);
	assert.equal(next.release.tag, "pi-v16.5.0-r2");
	assert.deepEqual(current, initialConfig(), "input must not be mutated");
});

test("resets revision for a new exact upstream tag", () => {
	const next = computeRecordedConfig(initialConfig(), {
		upstreamTag: "v16.6.0",
		upstreamCommit: "1111111111111111111111111111111111111111",
	});
	assert.equal(next.release.revision, 1);
	assert.equal(next.release.tag, "pi-v16.6.0-r1");
});

test("refuses to reinterpret an immutable upstream tag", () => {
	assert.throws(
		() =>
			computeRecordedConfig(initialConfig(), {
				upstreamTag: "v16.5.0",
				upstreamCommit: "1111111111111111111111111111111111111111",
			}),
		/already recorded with a different commit/,
	);
});

test("check detects stale generated provenance", () => {
	const repositoryRoot = fixtureRepository();
	checkRepository({ repositoryRoot, verifyHistory: false });
	writeFileSync(join(repositoryRoot, "PI_VENDOR.md"), "stale\n");
	assert.throws(() => checkRepository({ repositoryRoot, verifyHistory: false }), /PI_VENDOR.md is stale/);
});

test("record writes canonical JSON and provenance", () => {
	const repositoryRoot = fixtureRepository();
	const next = recordRepository({
		repositoryRoot,
		upstreamTag: "v16.6.0",
		upstreamCommit: "2222222222222222222222222222222222222222",
		verifyHistory: false,
	});
	assert.equal(next.release.tag, "pi-v16.6.0-r1");
	assert.deepEqual(JSON.parse(readFileSync(join(repositoryRoot, "automation/upstream-sync.json"), "utf8")), next);
	assert.equal(readFileSync(join(repositoryRoot, "PI_VENDOR.md"), "utf8"), renderProvenance(next));
});

test("record accepts the exact resolved MERGE_HEAD before the merge commit", () => {
	const repositoryRoot = fixtureRepository();
	git(repositoryRoot, "init", "-b", "main");
	git(repositoryRoot, "config", "user.name", "Upstream Sync Test");
	git(repositoryRoot, "config", "user.email", "upstream-sync@example.invalid");
	writeFileSync(join(repositoryRoot, "base.txt"), "base\n");
	git(repositoryRoot, "add", ".");
	git(repositoryRoot, "commit", "-m", "base");
	git(repositoryRoot, "checkout", "-b", "upstream");
	writeFileSync(join(repositoryRoot, "upstream.txt"), "upstream\n");
	git(repositoryRoot, "add", "upstream.txt");
	git(repositoryRoot, "commit", "-m", "upstream");
	const upstreamCommit = git(repositoryRoot, "rev-parse", "HEAD");
	git(repositoryRoot, "checkout", "main");
	git(repositoryRoot, "merge", "--no-ff", "--no-commit", "upstream");

	const next = recordRepository({ repositoryRoot, upstreamTag: "v16.6.0", upstreamCommit });
	assert.equal(next.upstream.commit, upstreamCommit);
	assert.equal(checkRepository({ repositoryRoot }).upstream.commit, upstreamCommit);
});

test("dry-run does not write files", () => {
	const repositoryRoot = fixtureRepository();
	const configBefore = readFileSync(join(repositoryRoot, "automation/upstream-sync.json"), "utf8");
	recordRepository({
		repositoryRoot,
		upstreamTag: "v16.6.0",
		upstreamCommit: "3333333333333333333333333333333333333333",
		dryRun: true,
		verifyHistory: false,
	});
	assert.equal(readFileSync(join(repositoryRoot, "automation/upstream-sync.json"), "utf8"), configBefore);
});
