import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

test("review rejects remote PR refs without resolving the disabled GitHub implementation", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-review-local-only-"));
	try {
		const probePath = path.join(root, "resolved.jsonl");
		const preloadPath = path.join(root, "preload.ts");
		await Bun.write(
			preloadPath,
			`import { appendFileSync } from "node:fs";
			Bun.plugin({ name: "pi-review-import-probe", setup(build) {
				build.onResolve({ filter: /.*/ }, args => {
					if (args.path.replaceAll("\\\\", "/").includes("/tools/gh")) appendFileSync(${JSON.stringify(probePath)}, args.path + "\\n");
					return undefined;
				});
			} });`,
		);
		const source = `
			import { ReviewCommand } from "@oh-my-pi/pi-coding-agent/extensibility/custom-commands/bundled/review";
			const command = new ReviewCommand({ cwd: process.cwd() });
			const result = await command.execute(["https://github.com/owner/repo/pull/123"], { hasUI: false });
			console.log(JSON.stringify(result));
		`;
		const proc = Bun.spawn([process.execPath, "--preload", preloadPath, "-e", source], {
			cwd: path.resolve(import.meta.dir, ".."),
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		expect(exitCode, stderr).toBe(0);
		expect(JSON.parse(stdout)).toContain("Remote pull-request review is unavailable in Pi");
		expect(await Bun.file(probePath).exists()).toBe(false);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});
