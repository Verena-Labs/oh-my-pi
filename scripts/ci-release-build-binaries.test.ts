import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { $ } from "bun";
import { resolveCrossBuild } from "../packages/coding-agent/scripts/build-binary";

const repoRoot = path.join(import.meta.dir, "..");

describe("Pi release binary targets", () => {
	it("builds a supported Pi artifact with Pi branding", async () => {
		const result = await $`bun scripts/ci-release-build-binaries.ts --dry-run --targets darwin-arm64`
			.cwd(repoRoot)
			.quiet()
			.nothrow();
		expect(result.exitCode).toBe(0);
		const output = result.text();

		expect(output).toContain("Building packages/coding-agent/binaries/pi-darwin-arm64...");
		expect(output).toContain(
			"DRY RUN Bun.build target=bun-darwin-arm64 outfile=packages/coding-agent/binaries/pi-darwin-arm64",
		);
		expect(output).toContain("external=fastembed,onnxruntime-node");
		expect(output.toLowerCase()).not.toContain("omp");
	});

	it("rejects the unverified Windows release target", async () => {
		expect(() => resolveCrossBuild("win32-x64")).toThrow("Unsupported CROSS_TARGET");
		const result = await $`bun scripts/ci-release-build-binaries.ts --dry-run --targets win32-x64`
			.cwd(repoRoot)
			.quiet()
			.nothrow();
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain("Unknown release target(s): win32-x64");
	});
});
