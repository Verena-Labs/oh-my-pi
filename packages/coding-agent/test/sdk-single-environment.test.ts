import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

test("public SDK entry points reject alternate permanent agent homes", async () => {
	const home = await fs.mkdtemp(path.join(os.tmpdir(), "pi-sdk-single-environment-"));
	try {
		const alternate = path.join(home, ".alternate-pi", "agent");
		const source = `
			import {
				createAgentSession,
				discoverAuthStorage,
				discoverCustomTSCommands,
				discoverPromptTemplates,
			} from "@oh-my-pi/pi-coding-agent";
			const alternate = ${JSON.stringify(alternate)};
			const calls = {
				createAgentSession: () => createAgentSession({ agentDir: alternate }),
				discoverAuthStorage: () => discoverAuthStorage(alternate),
				discoverCustomTSCommands: () => discoverCustomTSCommands(process.cwd(), alternate),
				discoverPromptTemplates: () => discoverPromptTemplates(process.cwd(), alternate),
			};
			const errors = {};
			for (const [name, call] of Object.entries(calls)) {
				try { await call(); } catch (error) { errors[name] = String(error); }
			}
			console.log(JSON.stringify(errors));
		`;
		const proc = Bun.spawn([process.execPath, "-e", source], {
			cwd: path.resolve(import.meta.dir, ".."),
			env: { ...process.env, HOME: home, NODE_ENV: "production" },
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		expect(exitCode, stderr).toBe(0);
		const expected = `Error: Pi SDK uses one agent directory at ${path.join(home, ".pi", "agent")}; alternate agent directories are unavailable.`;
		expect(JSON.parse(stdout)).toEqual({
			createAgentSession: expected,
			discoverAuthStorage: expected,
			discoverCustomTSCommands: expected,
			discoverPromptTemplates: expected,
		});
	} finally {
		await fs.rm(home, { recursive: true, force: true });
	}
});
