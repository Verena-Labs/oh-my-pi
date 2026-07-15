import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const packageRoot = path.resolve(import.meta.dir, "..");

const BLOCKED_SUBPATHS = [
	"@oh-my-pi/pi-coding-agent/autolearn/controller",
	"@oh-my-pi/pi-coding-agent/autolearn/managed-skills",
	"@oh-my-pi/pi-coding-agent/auto-thinking/classifier",
	"@oh-my-pi/pi-coding-agent/auto-thinking/classifier.js",
	"@oh-my-pi/pi-coding-agent/autoresearch",
	"@oh-my-pi/pi-coding-agent/autoresearch/state",
	"@oh-my-pi/pi-coding-agent/autoresearch/tools/run-experiment",
	"@oh-my-pi/pi-coding-agent/capability/rule",
	"@oh-my-pi/pi-coding-agent/capability/rule.js",
	"@oh-my-pi/pi-coding-agent/capability/rule-buckets",
	"@oh-my-pi/pi-coding-agent/capability/rule-buckets.js",
	"@oh-my-pi/pi-coding-agent/cli/update-cli",
	"@oh-my-pi/pi-coding-agent/cli/update-cli.js",
	"@oh-my-pi/pi-coding-agent/cli/ssh-cli",
	"@oh-my-pi/pi-coding-agent/cli/ssh-cli.js",
	"@oh-my-pi/pi-coding-agent/cli/auth-broker-cli",
	"@oh-my-pi/pi-coding-agent/cli/auth-broker-cli.js",
	"@oh-my-pi/pi-coding-agent/cli/auth-gateway-cli",
	"@oh-my-pi/pi-coding-agent/cli/auth-gateway-cli.js",
	"@oh-my-pi/pi-coding-agent/cli/dry-balance-cli",
	"@oh-my-pi/pi-coding-agent/cli/dry-balance-cli.js",
	"@oh-my-pi/pi-coding-agent/cli/profile-alias",
	"@oh-my-pi/pi-coding-agent/cli/profile-alias.js",
	"@oh-my-pi/pi-coding-agent/cli/profile-bootstrap",
	"@oh-my-pi/pi-coding-agent/cli/profile-bootstrap.js",
	"@oh-my-pi/pi-coding-agent/cli/ttsr-cli",
	"@oh-my-pi/pi-coding-agent/cli/ttsr-cli.js",
	"@oh-my-pi/pi-coding-agent/commands/acp",
	"@oh-my-pi/pi-coding-agent/commands/auth-broker",
	"@oh-my-pi/pi-coding-agent/commands/auth-broker.js",
	"@oh-my-pi/pi-coding-agent/commands/auth-gateway",
	"@oh-my-pi/pi-coding-agent/commands/auth-gateway.js",
	"@oh-my-pi/pi-coding-agent/commands/commit",
	"@oh-my-pi/pi-coding-agent/commands/dry-balance",
	"@oh-my-pi/pi-coding-agent/commands/dry-balance.js",
	"@oh-my-pi/pi-coding-agent/commands/join",
	"@oh-my-pi/pi-coding-agent/commands/say",
	"@oh-my-pi/pi-coding-agent/commands/say.js",
	"@oh-my-pi/pi-coding-agent/commands/ssh",
	"@oh-my-pi/pi-coding-agent/commands/ssh.js",
	"@oh-my-pi/pi-coding-agent/commands/token",
	"@oh-my-pi/pi-coding-agent/commands/token.js",
	"@oh-my-pi/pi-coding-agent/commands/ttsr",
	"@oh-my-pi/pi-coding-agent/commands/ttsr.js",
	"@oh-my-pi/pi-coding-agent/commands/update",
	"@oh-my-pi/pi-coding-agent/commit",
	"@oh-my-pi/pi-coding-agent/commit/agentic",
	"@oh-my-pi/pi-coding-agent/commit/agentic/agent",
	"@oh-my-pi/pi-coding-agent/commit/agentic/tools/commit",
	"@oh-my-pi/pi-coding-agent/commit/analysis",
	"@oh-my-pi/pi-coding-agent/commit/analysis/summary",
	"@oh-my-pi/pi-coding-agent/commit/changelog",
	"@oh-my-pi/pi-coding-agent/commit/changelog/generate",
	"@oh-my-pi/pi-coding-agent/commit/cli",
	"@oh-my-pi/pi-coding-agent/commit/map-reduce",
	"@oh-my-pi/pi-coding-agent/commit/map-reduce/map-phase",
	"@oh-my-pi/pi-coding-agent/commit/model-selection",
	"@oh-my-pi/pi-coding-agent/commit/pipeline",
	"@oh-my-pi/pi-coding-agent/commit/shared-llm",
	"@oh-my-pi/pi-coding-agent/dap",
	"@oh-my-pi/pi-coding-agent/dap/client",
	"@oh-my-pi/pi-coding-agent/eval",
	"@oh-my-pi/pi-coding-agent/eval/agent-bridge",
	"@oh-my-pi/pi-coding-agent/eval/agent-bridge.js",
	"@oh-my-pi/pi-coding-agent/eval/backend",
	"@oh-my-pi/pi-coding-agent/eval/js/executor",
	"@oh-my-pi/pi-coding-agent/eval/jl/kernel",
	"@oh-my-pi/pi-coding-agent/eval/py/executor",
	"@oh-my-pi/pi-coding-agent/eval/rb/executor",
	"@oh-my-pi/pi-coding-agent/extensibility/custom-commands/bundled/ci-green",
	"@oh-my-pi/pi-coding-agent/export/share",
	"@oh-my-pi/pi-coding-agent/export/ttsr",
	"@oh-my-pi/pi-coding-agent/export/ttsr.js",
	"@oh-my-pi/pi-coding-agent/internal-urls/issue-pr-protocol",
	"@oh-my-pi/pi-coding-agent/internal-urls/rule-protocol",
	"@oh-my-pi/pi-coding-agent/modes/acp",
	"@oh-my-pi/pi-coding-agent/modes/acp/acp-mode",
	"@oh-my-pi/pi-coding-agent/modes/components/snapcompact-shape-preview",
	"@oh-my-pi/pi-coding-agent/modes/components/snapcompact-shape-preview.js",
	"@oh-my-pi/pi-coding-agent/modes/components/tree-selector",
	"@oh-my-pi/pi-coding-agent/modes/components/tree-selector.js",
	"@oh-my-pi/pi-coding-agent/modes/components/ttsr-notification",
	"@oh-my-pi/pi-coding-agent/modes/components/ttsr-notification.js",
	"@oh-my-pi/pi-coding-agent/modes/controllers/omfg-controller",
	"@oh-my-pi/pi-coding-agent/modes/controllers/omfg-controller.js",
	"@oh-my-pi/pi-coding-agent/modes/controllers/omfg-rule",
	"@oh-my-pi/pi-coding-agent/modes/controllers/omfg-rule.js",
	"@oh-my-pi/pi-coding-agent/modes/controllers/ssh-command-controller",
	"@oh-my-pi/pi-coding-agent/modes/controllers/ssh-command-controller.js",
	"@oh-my-pi/pi-coding-agent/modes/controllers/tan-command-controller",
	"@oh-my-pi/pi-coding-agent/modes/controllers/tan-command-controller.js",
	"@oh-my-pi/pi-coding-agent/secrets",
	"@oh-my-pi/pi-coding-agent/secrets/obfuscator",
	"@oh-my-pi/pi-coding-agent/secrets/obfuscator.js",
	"@oh-my-pi/pi-coding-agent/secrets/regex",
	"@oh-my-pi/pi-coding-agent/session/auth-broker-config",
	"@oh-my-pi/pi-coding-agent/session/auth-broker-config.js",
	"@oh-my-pi/pi-coding-agent/session/compact-modes",
	"@oh-my-pi/pi-coding-agent/session/compact-modes.js",
	"@oh-my-pi/pi-coding-agent/session/checkpoint-rewind-private",
	"@oh-my-pi/pi-coding-agent/session/checkpoint-rewind-private.js",
	"@oh-my-pi/pi-coding-agent/session/exit-diagnostics",
	"@oh-my-pi/pi-coding-agent/session/exit-diagnostics.js",
	"@oh-my-pi/pi-coding-agent/session/history-storage",
	"@oh-my-pi/pi-coding-agent/session/history-storage.js",
	"@oh-my-pi/pi-coding-agent/session/snapcompact-inline",
	"@oh-my-pi/pi-coding-agent/session/snapcompact-inline.js",
	"@oh-my-pi/pi-coding-agent/session/snapcompact-savings-journal",
	"@oh-my-pi/pi-coding-agent/session/snapcompact-savings-journal.js",
	"@oh-my-pi/pi-coding-agent/session/unexpected-stop-classifier",
	"@oh-my-pi/pi-coding-agent/session/unexpected-stop-classifier.js",
	"@oh-my-pi/pi-coding-agent/ssh/ssh-executor",
	"@oh-my-pi/pi-coding-agent/ssh/sshfs-mount",
	"@oh-my-pi/pi-coding-agent/ssh/config-writer",
	"@oh-my-pi/pi-coding-agent/ssh/config-writer.js",
	"@oh-my-pi/pi-coding-agent/ssh/connection-manager",
	"@oh-my-pi/pi-coding-agent/ssh/file-transfer",
	"@oh-my-pi/pi-coding-agent/ssh/utils",
	"@oh-my-pi/pi-coding-agent/stt",
	"@oh-my-pi/pi-coding-agent/stt/asr-client",
	"@oh-my-pi/pi-coding-agent/task/isolation-runner",
	"@oh-my-pi/pi-coding-agent/task/omp-command",
	"@oh-my-pi/pi-coding-agent/task/worktree",
	"@oh-my-pi/pi-coding-agent/tools/acp-bridge",
	"@oh-my-pi/pi-coding-agent/tools/debug",
	"@oh-my-pi/pi-coding-agent/tools/eval",
	"@oh-my-pi/pi-coding-agent/tools/eval-backends",
	"@oh-my-pi/pi-coding-agent/tools/eval-render",
	"@oh-my-pi/pi-coding-agent/tools/gh",
	"@oh-my-pi/pi-coding-agent/tools/gh-cache-invalidation",
	"@oh-my-pi/pi-coding-agent/tools/manage-skill",
	"@oh-my-pi/pi-coding-agent/tools/manage-skill.js",
	"@oh-my-pi/pi-coding-agent/tools/ssh",
	"@oh-my-pi/pi-coding-agent/tools/tts",
	"@oh-my-pi/pi-coding-agent/web/kagi",
	"@oh-my-pi/pi-coding-agent/web/parallel",
	"@oh-my-pi/pi-coding-agent/web/scrapers",
	"@oh-my-pi/pi-coding-agent/web/scrapers/index",
	"@oh-my-pi/pi-coding-agent/web/scrapers/arxiv",
	"@oh-my-pi/pi-coding-agent/web/scrapers/github",
	"@oh-my-pi/pi-coding-agent/web/scrapers/npm",
	"@oh-my-pi/pi-coding-agent/web/scrapers/wikipedia",
	"@oh-my-pi/pi-coding-agent/web/search/providers/anthropic",
	"@oh-my-pi/pi-coding-agent/web/search/providers/brave",
	"@oh-my-pi/pi-coding-agent/web/search/providers/browser-headers",
	"@oh-my-pi/pi-coding-agent/web/search/providers/browser-page",
	"@oh-my-pi/pi-coding-agent/web/search/providers/exa",
	"@oh-my-pi/pi-coding-agent/web/search/providers/firecrawl",
	"@oh-my-pi/pi-coding-agent/web/search/providers/gemini",
	"@oh-my-pi/pi-coding-agent/web/search/providers/google",
	"@oh-my-pi/pi-coding-agent/web/search/providers/jina",
	"@oh-my-pi/pi-coding-agent/web/search/providers/kagi",
	"@oh-my-pi/pi-coding-agent/web/search/providers/kimi",
	"@oh-my-pi/pi-coding-agent/web/search/providers/mojeek",
	"@oh-my-pi/pi-coding-agent/web/search/providers/parallel",
	"@oh-my-pi/pi-coding-agent/web/search/providers/perplexity",
	"@oh-my-pi/pi-coding-agent/web/search/providers/perplexity-auth",
	"@oh-my-pi/pi-coding-agent/web/search/providers/public",
	"@oh-my-pi/pi-coding-agent/web/search/providers/searxng",
	"@oh-my-pi/pi-coding-agent/web/search/providers/startpage",
	"@oh-my-pi/pi-coding-agent/web/search/providers/synthetic",
	"@oh-my-pi/pi-coding-agent/web/search/providers/tavily",
	"@oh-my-pi/pi-coding-agent/web/search/providers/tinyfish",
	"@oh-my-pi/pi-coding-agent/web/search/providers/utils",
	"@oh-my-pi/pi-coding-agent/web/search/providers/xai",
	"@oh-my-pi/pi-coding-agent/web/search/providers/zai",
	"@oh-my-pi/pi-coding-agent/discovery/agents",
	"@oh-my-pi/pi-coding-agent/discovery/builtin-defaults",
	"@oh-my-pi/pi-coding-agent/discovery/builtin-defaults.js",
	"@oh-my-pi/pi-coding-agent/discovery/claude",
	"@oh-my-pi/pi-coding-agent/discovery/cline",
	"@oh-my-pi/pi-coding-agent/discovery/codex",
	"@oh-my-pi/pi-coding-agent/discovery/cursor",
	"@oh-my-pi/pi-coding-agent/discovery/gemini",
	"@oh-my-pi/pi-coding-agent/discovery/github",
	"@oh-my-pi/pi-coding-agent/discovery/opencode",
	"@oh-my-pi/pi-coding-agent/discovery/vscode",
	"@oh-my-pi/pi-coding-agent/discovery/windsurf",
] as const;

const RETAINED_SUBPATHS = [
	"@oh-my-pi/pi-coding-agent",
	"@oh-my-pi/pi-coding-agent/cli/plugin-cli",
	"@oh-my-pi/pi-coding-agent/commands/models",
	"@oh-my-pi/pi-coding-agent/commit/git/diff",
	"@oh-my-pi/pi-coding-agent/commit/message",
	"@oh-my-pi/pi-coding-agent/commit/types",
	"@oh-my-pi/pi-coding-agent/commit/utils",
	"@oh-my-pi/pi-coding-agent/commit/utils/exclusions",
	"@oh-my-pi/pi-coding-agent/discovery/claude-plugins",
	"@oh-my-pi/pi-coding-agent/debug",
	"@oh-my-pi/pi-coding-agent/export/html",
	"@oh-my-pi/pi-coding-agent/internal-urls/omp-protocol",
	"@oh-my-pi/pi-coding-agent/modes/components/history-search",
	"@oh-my-pi/pi-coding-agent/modes/rpc/rpc-mode",
	"@oh-my-pi/pi-coding-agent/task",
	"@oh-my-pi/pi-coding-agent/task/executor",
	"@oh-my-pi/pi-coding-agent/session/session-context",
	"@oh-my-pi/pi-coding-agent/tools",
	"@oh-my-pi/pi-coding-agent/tools/learn",
	"@oh-my-pi/pi-coding-agent/web/scrapers/types",
	"@oh-my-pi/pi-coding-agent/web/scrapers/utils",
	"@oh-my-pi/pi-coding-agent/web/search",
	"@oh-my-pi/pi-coding-agent/web/search/provider",
	"@oh-my-pi/pi-coding-agent/web/search/render",
	"@oh-my-pi/pi-coding-agent/web/search/types",
	"@oh-my-pi/pi-coding-agent/web/search/utils",
	"@oh-my-pi/pi-coding-agent/web/search/providers/base",
	"@oh-my-pi/pi-coding-agent/web/search/providers/codex",
	"@oh-my-pi/pi-coding-agent/web/search/providers/duckduckgo",
] as const;

interface ImportProbeResult {
	readonly code?: string;
	readonly message?: string;
	readonly status: "error" | "loaded";
}

interface IdleProbeEvent {
	readonly kind: string;
	readonly module?: string;
	readonly url?: string;
}

async function readIdleProbeEvents(probePath: string): Promise<IdleProbeEvent[]> {
	const file = Bun.file(probePath);
	if (!(await file.exists())) return [];
	const text = await file.text();
	return text
		.split("\n")
		.filter(line => line.length > 0)
		.map(line => JSON.parse(line) as IdleProbeEvent);
}

async function probeImports(specifiers: readonly string[]): Promise<Record<string, ImportProbeResult>> {
	const source = `
		const specifiers = ${JSON.stringify(specifiers)};
		const results = {};
		for (const specifier of specifiers) {
			try {
				await import(specifier);
				results[specifier] = { status: "loaded" };
			} catch (error) {
				results[specifier] = {
					status: "error",
					code: error && typeof error === "object" && "code" in error ? String(error.code) : undefined,
					message: error instanceof Error ? error.message : String(error),
				};
			}
		}
		console.log(JSON.stringify(results));
	`;
	const proc = Bun.spawn([process.execPath, "-e", source], {
		cwd: packageRoot,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, NO_COLOR: "1" },
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	expect(exitCode, stderr).toBe(0);
	return JSON.parse(stdout) as Record<string, ImportProbeResult>;
}

describe("Phase 3 public package boundary", () => {
	it("rejects disabled service, tool, execution, specialized web, and foreign-discovery deep imports", async () => {
		const results = await probeImports(BLOCKED_SUBPATHS);
		for (const specifier of BLOCKED_SUBPATHS) {
			const result = results[specifier];
			expect(result?.status, specifier).toBe("error");
			expect(result?.code, specifier).toBe("ERR_MODULE_NOT_FOUND");
			expect(result?.message, specifier).toContain(specifier);
		}
	});

	it("keeps retained command, plugin, export, RPC, rich-web, and selected-search imports available", async () => {
		const results = await probeImports(RETAINED_SUBPATHS);
		for (const specifier of RETAINED_SUBPATHS) {
			expect(results[specifier], specifier).toEqual({ status: "loaded" });
		}
	});

	it("keeps Bun's historical tools/learn.js alias available", async () => {
		const specifier = "@oh-my-pi/pi-coding-agent/tools/learn.js";
		const results = await probeImports([specifier]);
		expect(results[specifier]).toEqual({ status: "loaded" });
	});

	it("keeps the public history-search .js alias available", async () => {
		for (const specifier of ["@oh-my-pi/pi-coding-agent/modes/components/history-search.js"]) {
			const results = await probeImports([specifier]);
			expect(results[specifier], specifier).toEqual({ status: "loaded" });
		}
	});

	it("does not re-export disabled protocol constructors from the retained internal URL barrel", async () => {
		const internalUrls = await import("@oh-my-pi/pi-coding-agent/internal-urls");
		expect("IssuePrProtocolHandler" in internalUrls).toBe(false);
		expect("RuleProtocolHandler" in internalUrls).toBe(false);
	});

	it("keeps retained root barrels narrow without exporting disabled tools, brokers, or sub-session collection", async () => {
		const [root, tools, components, ...htmlEntrypoints] = await Promise.all([
			import("@oh-my-pi/pi-coding-agent"),
			import("@oh-my-pi/pi-coding-agent/tools"),
			import("@oh-my-pi/pi-coding-agent/modes/components"),
			import("@oh-my-pi/pi-coding-agent/export/html"),
			import("@oh-my-pi/pi-coding-agent/export/html/index"),
		]);
		expect("LearnTool" in root).toBe(true);
		expect("LearnTool" in tools).toBe(true);
		for (const name of ["ManageSkillTool", "runAuthBrokerCommand", "runAuthGatewayCommand"]) {
			expect(name in root, name).toBe(false);
		}
		expect("HistoryStorage" in root).toBe(false);
		expect("ManageSkillTool" in tools).toBe(false);
		expect("HistorySearchComponent" in components).toBe(false);
		expect("SnapcompactShapePreview" in components).toBe(false);
		expect("TreeSelectorComponent" in components).toBe(false);
		expect("TtsrNotificationComponent" in components).toBe(false);
		expect("TreeSelectorComponent" in root).toBe(false);
		expect("TtsrNotificationComponent" in root).toBe(false);
		for (const html of htmlEntrypoints) {
			expect("collectSubSessions" in html).toBe(false);
		}
	});

	it("cold-starts RPC and remains idle without resolving or contacting disabled services", async () => {
		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-phase3a-idle-"));
		const probePath = path.join(tempRoot, "disabled-service-probe.jsonl");
		const preloadPath = path.join(tempRoot, "disabled-service-preload.ts");
		const preloadSource = `
				import { appendFileSync } from "node:fs";
				const probePath = ${JSON.stringify(probePath)};
				const record = event => appendFileSync(probePath, JSON.stringify(event) + "\\n");
				const disabledFragments = [
					"/collab",
					"/modes/acp",
					"/commands/acp",
					"/commands/join",
					"/commands/update",
					"/cli/update-cli",
					"/export/share",
					"/tools/acp-bridge",
				];
				Bun.plugin({
					name: "pi-disabled-service-idle-probe",
					setup(build) {
						build.onResolve({ filter: /.*/ }, args => {
							const normalized = args.path.replaceAll("\\\\", "/");
							if (disabledFragments.some(fragment => normalized.includes(fragment))) {
								record({ kind: "disabled-resolve", module: normalized });
							}
							return undefined;
						});
					},
				});
				const originalFetch = globalThis.fetch;
				globalThis.fetch = new Proxy(originalFetch, {
					apply(target, thisArg, args) {
						const input = args[0];
						const url = input instanceof Request ? input.url : String(input);
						if ((url.includes("registry.npmjs.org") && url.includes("pi-coding-agent") && url.includes("/latest")) || url.includes("omp.sh")) {
							record({ kind: "disabled-fetch", url });
						}
						return Reflect.apply(target, thisArg, args);
					},
				});
				const OriginalWebSocket = globalThis.WebSocket;
				globalThis.WebSocket = new Proxy(OriginalWebSocket, {
					construct(target, args, newTarget) {
						record({ kind: "websocket", url: String(args[0]) });
						return Reflect.construct(target, args, newTarget);
					},
				});
				let readyObserved = false;
				process.stdout.write = new Proxy(process.stdout.write, {
					apply(target, thisArg, args) {
						const chunk = args[0];
						const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
						if (!readyObserved && text.includes('"type":"ready"')) {
							readyObserved = true;
							record({ kind: "ready" });
							setTimeout(() => record({ kind: "idle" }), 400);
						}
						return Reflect.apply(target, thisArg, args);
					},
				});
			`;

		await Bun.write(preloadPath, preloadSource);
		const env = { ...process.env };
		delete env.OMP_PROFILE;
		delete env.PI_PROFILE;
		Object.assign(env, {
			HOME: tempRoot,
			NO_COLOR: "1",
			PI_CODING_AGENT_DIR: path.join(tempRoot, ".pi", "agent"),
			PI_CONFIG_DIR: ".pi",
			XDG_CACHE_HOME: path.join(tempRoot, ".cache"),
			XDG_CONFIG_HOME: path.join(tempRoot, ".config"),
			XDG_DATA_HOME: path.join(tempRoot, ".local", "share"),
		});

		const proc = Bun.spawn(
			[
				process.execPath,
				"--preload",
				preloadPath,
				path.join(packageRoot, "src", "cli.ts"),
				"--mode",
				"rpc",
				"--no-session",
				"--provider",
				"anthropic",
				"--model",
				"claude-sonnet-4-5",
			],
			{ cwd: tempRoot, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
		);
		const stdoutPromise = new Response(proc.stdout).text();
		const stderrPromise = new Response(proc.stderr).text();
		let events: IdleProbeEvent[] = [];

		try {
			const deadline = Date.now() + 12_000;
			while (Date.now() < deadline && proc.exitCode === null) {
				events = await readIdleProbeEvents(probePath);
				if (events.some(event => event.kind === "idle")) break;
				await Bun.sleep(50);
			}

			if (proc.exitCode === null) proc.kill();
			await proc.exited;
			const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
			expect(
				events.some(event => event.kind === "ready"),
				`stdout:\n${stdout}\nstderr:\n${stderr}`,
			).toBe(true);
			expect(
				events.some(event => event.kind === "idle"),
				`stdout:\n${stdout}\nstderr:\n${stderr}`,
			).toBe(true);
			expect(events.filter(event => !["ready", "idle"].includes(event.kind))).toEqual([]);
		} finally {
			if (proc.exitCode === null) {
				proc.kill();
				await proc.exited;
			}
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	}, 20_000);
});
