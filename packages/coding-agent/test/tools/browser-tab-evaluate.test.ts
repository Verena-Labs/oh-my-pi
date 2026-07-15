import { describe, expect, it } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/sdk";
import { BrowserTool } from "@oh-my-pi/pi-coding-agent/tools/browser";
import { ensureChromiumExecutable } from "@oh-my-pi/pi-coding-agent/tools/browser/launch";

function makeSession(): ToolSession {
	return {
		cwd: "/tmp/test",
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated({ "browser.headless": true }),
	};
}

/**
 * Whether the Chromium puppeteer resolves can actually execute on this host.
 * CI runners without Chrome's system libraries (libnspr4 & co.) hold the
 * downloaded binary but cannot exec it — probe with --version and skip
 * instead of failing.
 */
async function chromiumCanLaunch(): Promise<boolean> {
	try {
		const executable = await ensureChromiumExecutable();
		if (!executable) return false;
		const probe = Bun.spawnSync([executable, "--version"], { stdout: "ignore", stderr: "ignore" });
		return probe.exitCode === 0;
	} catch {
		return false;
	}
}

const CHROMIUM_AVAILABLE = await chromiumCanLaunch();

describe.skipIf(!CHROMIUM_AVAILABLE)("browser tab evaluation", () => {
	// Launches real headless Chromium; CI cold start easily exceeds bun's 5s default.
	it("runs tab.evaluate in the page's main JavaScript world", async () => {
		const tool = new BrowserTool(makeSession());
		const name = `main-world-${process.pid}`;

		try {
			await tool.execute("open", {
				action: "open",
				name,
				url: "data:text/html,<script>globalThis.__ompMainWorld = 42</script>",
			});
			const result = await tool.execute("run", {
				action: "run",
				name,
				code: "return await tab.evaluate(() => globalThis.__ompMainWorld);",
			});

			expect(result.content).toEqual([{ type: "text", text: "42" }]);

			const rawPageResult = await tool.execute("run", {
				action: "run",
				name,
				code: "return await page.evaluate(() => 6 * 7);",
			});
			expect(rawPageResult.content).toEqual([{ type: "text", text: "42" }]);

			const boundary = await tool.execute("run", {
				action: "run",
				name,
				code: `return [
					typeof tool, typeof completion, typeof output, typeof agent,
					typeof parallel, typeof pipeline, typeof read, typeof write, typeof env,
					typeof __omp_call_tool__, typeof process, typeof Bun, typeof require,
					typeof fs, typeof fetch, typeof Function, typeof eval,
					typeof globalThis.process,
				].join("|");`,
			});
			expect(boundary.content).toEqual([
				{
					type: "text",
					text: Array.from({ length: 18 }, () => "undefined").join("|"),
				},
			]);

			const computedBoundary = await tool.execute("run", {
				action: "run",
				name,
				code: `const key = ["con", "structor"].join("");
				const capture = async attempt => {
					try {
						const value = await attempt();
						return value === undefined ? "unavailable" : "escaped";
					} catch (error) {
						return error?.name ?? "blocked";
					}
				};
				return [
					await capture(() => (() => {})[key]("return process")()),
					await capture(() => Reflect.get(() => {}, key)("return process")()),
					typeof page.url[key],
					typeof Reflect.get(page.url, key),
					await capture(() => globalThis.process?.getBuiltinModule("node:fs")),
					await capture(() => (() => {})[key]("return process.getBuiltinModule('node:fs')")()),
					await capture(() => (() => {})[key]("return process.getBuiltinModule('node:http')")()),
					await capture(() => (() => {})[key]("return process.getBuiltinModule('node:child_process')")()),
					typeof fetch,
					typeof WebSocket,
				].join("|");`,
			});
			expect(computedBoundary.content).toEqual([
				{
					type: "text",
					text: [
						"EvalError",
						"EvalError",
						"undefined",
						"undefined",
						"unavailable",
						"EvalError",
						"EvalError",
						"EvalError",
						"undefined",
						"undefined",
					].join("|"),
				},
			]);
		} finally {
			await tool.execute("close", { action: "close", name, kill: true });
		}
	}, 30_000);
});
