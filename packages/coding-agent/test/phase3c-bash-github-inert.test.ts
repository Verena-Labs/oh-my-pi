import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

test("retained bash does not resolve the disabled GitHub cache lifecycle", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-bash-github-inert-"));
	try {
		const probePath = path.join(root, "resolved.jsonl");
		const preloadPath = path.join(root, "preload.ts");
		await Bun.write(
			preloadPath,
			`import { appendFileSync } from "node:fs";
			Bun.plugin({ name: "pi-bash-github-probe", setup(build) {
				build.onResolve({ filter: /.*/ }, args => {
					const normalized = args.path.replaceAll("\\\\", "/");
					if (normalized.includes("gh-cache-invalidation") || normalized.includes("github-cache")) appendFileSync(${JSON.stringify(probePath)}, normalized + "\\n");
					return undefined;
				});
			} });`,
		);
		const proc = Bun.spawn(
			[process.execPath, "--preload", preloadPath, "-e", 'await import("@oh-my-pi/pi-coding-agent/tools/bash")'],
			{
				cwd: path.resolve(import.meta.dir, ".."),
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
		expect(exitCode, stderr).toBe(0);
		expect(await Bun.file(probePath).exists()).toBe(false);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});
