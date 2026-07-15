import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const workflow = readFileSync(join(repositoryRoot, ".github/workflows/ci.yml"), "utf8");

describe("downstream source-only CI", () => {
	it("serializes work by ref and cancels stale runs", () => {
		expect(workflow).toContain("group: downstream-ci-$" + "{{ github.ref }}");
		expect(workflow).toContain("cancel-in-progress: true");
	});

	it("uses only read access and public GitHub-hosted runners", () => {
		expect(workflow).toMatch(/permissions:\s+contents: read/);
		expect(workflow).not.toMatch(/contents: write|packages: write|id-token: write/);
		expect(workflow).not.toMatch(/runs-on:.*(?:omp-kata|self-hosted)/);
	});

	it("has no package, binary, release, or tap publication jobs", () => {
		expect(workflow).not.toMatch(
			/npm publish|release_github|release_binary|release_npm|release_brew|action-gh-release/,
		);
		expect(workflow).not.toMatch(/upload-artifact|HOMEBREW|NPM_TOKEN|APPLE_CERTIFICATE/);
	});

	it("runs fork policy, contract, and source checks", () => {
		expect(workflow).toContain("node scripts/upstream-sync.mjs check");
		expect(workflow).toContain("node scripts/check-pi-product-docs.mjs");
		expect(workflow).toContain("node scripts/check-pi-phase4-evidence.mjs");
		expect(workflow).toContain("bun run ci:check:full");
	});
});
