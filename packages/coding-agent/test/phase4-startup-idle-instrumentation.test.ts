import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type ProbeEvent = { kind: string; [key: string]: unknown };

const packageRoot = path.resolve(import.meta.dir, "..");
const builtInProviders = [
	"aimlapi",
	"alibaba-coding-plan",
	"baseten",
	"amazon-bedrock",
	"anthropic",
	"azure",
	"cerebras",
	"cloudflare-ai-gateway",
	"cursor",
	"deepseek",
	"devin",
	"firepass",
	"fireworks",
	"github-copilot",
	"gitlab-duo",
	"gitlab-duo-agent",
	"google",
	"google-antigravity",
	"google-gemini-cli",
	"google-vertex",
	"groq",
	"huggingface",
	"kilo",
	"kimi-code",
	"litellm",
	"lm-studio",
	"minimax",
	"minimax-code",
	"minimax-code-cn",
	"mistral",
	"moonshot",
	"nanogpt",
	"nvidia",
	"novita",
	"ollama",
	"ollama-cloud",
	"openai",
	"openai-codex",
	"opencode-go",
	"opencode-zen",
	"openrouter",
	"qianfan",
	"qwen-portal",
	"sakana",
	"synthetic",
	"together",
	"umans",
	"venice",
	"vercel-ai-gateway",
	"vllm",
	"wafer-serverless",
	"coreweave",
	"xai",
	"xai-oauth",
	"xiaomi",
	"xiaomi-token-plan-ams",
	"xiaomi-token-plan-cn",
	"xiaomi-token-plan-sgp",
	"zai",
	"zenmux",
	"zhipu-coding-plan",
] as const;

async function readEvents(probePath: string): Promise<ProbeEvent[]> {
	try {
		return fs
			.readFileSync(probePath, "utf8")
			.split("\n")
			.filter(Boolean)
			.map(line => JSON.parse(line) as ProbeEvent);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

function listTree(root: string, prefix = ""): string[] {
	const directory = path.join(root, prefix);
	if (!fs.existsSync(directory)) return [];
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
		const relativePath = path.join(prefix, entry.name);
		return entry.isDirectory() ? [relativePath, ...listTree(root, relativePath)] : [relativePath];
	});
}

test("cold RPC startup and idle instrument every disabled side-effect class", async () => {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-phase4-idle-"));
	const agentDir = path.join(tempRoot, ".pi", "agent");
	const workDir = path.join(tempRoot, "work");
	const probePath = path.join(tempRoot, "phase4-idle-probe.jsonl");
	const preloadPath = path.join(tempRoot, "phase4-idle-preload.ts");
	fs.mkdirSync(agentDir, { recursive: true });
	fs.mkdirSync(workDir, { recursive: true });
	fs.writeFileSync(
		path.join(agentDir, "config.yml"),
		`marketplace:\n  autoUpdate: off\nstartup:\n  quiet: true\n  showSplash: false\nlsp:\n  enabled: false\ndisabledProviders:\n${builtInProviders.map(provider => `  - ${provider}`).join("\n")}\n`,
	);
	fs.writeFileSync(
		path.join(agentDir, "models.yml"),
		"providers:\n  smoke:\n    baseUrl: http://127.0.0.1:9/v1\n    api: openai-completions\n    auth: none\n    models:\n      - id: offline\n        name: Offline Smoke\n        contextWindow: 8192\n        maxTokens: 1024\n",
	);

	const preloadSource = String.raw`
		import fs from "node:fs";
		import childProcess from "node:child_process";
		import { syncBuiltinESMExports } from "node:module";
		const probePath = ${JSON.stringify(probePath)};
		const originalAppend = fs.appendFileSync.bind(fs);
		const record = event => originalAppend(probePath, JSON.stringify(event) + "\n");
		const disabledModule = /\/(?:collab|modes\/acp|commands\/(?:acp|join|update|ssh|say|ttsr|commit)|cli\/(?:auth-broker|auth-gateway|update-cli)|auth-(?:broker|gateway)|remote-auth|autoresearch|rulebook)(?:\/|$)/u;
		const disabledState = /(?:^|\/)(?:\.omp|collab|auth-broker|auth-gateway|remote-auth|ssh-control|tts|autoresearch)(?:\/|$)/iu;
		const credentialPath = /(?:^|\/)(?:\.aws|\.azure|\.ssh|\.docker|\.config\/gcloud)(?:\/|$)|(?:^|\/)(?:\.netrc|\.npmrc|credentials)(?:$|\.)/iu;
		const pathText = value => value instanceof URL ? value.pathname : Buffer.isBuffer(value) ? value.toString() : String(value ?? "");
		const stack = () => new Error().stack ?? "";

		record({
			kind: "instrumented",
			classes: ["network", "credential", "filesystem", "child-process", "watcher", "timer", "persistent-store"],
		});

		Bun.plugin({
			name: "pi-phase4-disabled-module-probe",
			setup(build) {
				build.onResolve({ filter: /.*/ }, args => {
					const normalized = args.path.replaceAll("\\\\", "/");
					if (disabledModule.test(normalized)) record({ kind: "disabled-module", module: normalized });
					return undefined;
				});
			},
		});

		const originalFetch = globalThis.fetch;
		const instrumentedFetch = function(...args) {
				const input = args[0];
				const url = input instanceof Request ? input.url : String(input);
				record({ kind: "network", operation: "fetch", url, stack: stack() });
				return Reflect.apply(originalFetch, globalThis, args);
		};
		Object.defineProperty(instrumentedFetch, "preconnect", {
			value: url => {
				const rendered = String(url);
				record({ kind: rendered.startsWith("http://127.0.0.1:") ? "local-preconnect" : "network", operation: "preconnect", url: rendered, stack: stack() });
				return Reflect.apply(originalFetch.preconnect, originalFetch, [url]);
			},
			enumerable: true,
		});
		globalThis.fetch = instrumentedFetch;

		if (typeof globalThis.WebSocket === "function") {
			globalThis.WebSocket = new Proxy(globalThis.WebSocket, {
				construct(target, args, newTarget) {
					record({ kind: "network", operation: "websocket", url: String(args[0]), stack: stack() });
					return Reflect.construct(target, args, newTarget);
				},
			});
		}
		for (const method of ["connect", "listen", "serve"]) {
			if (typeof Bun[method] !== "function") continue;
			const original = Bun[method];
			Bun[method] = new Proxy(original, {
				apply(target, thisArg, args) {
					record({ kind: "network", operation: "Bun." + method, stack: stack() });
					return Reflect.apply(target, thisArg, args);
				},
			});
		}

		for (const method of ["spawn", "spawnSync"]) {
			const original = Bun[method];
			Bun[method] = new Proxy(original, {
				apply(target, thisArg, args) {
					const command = String(args[0]);
					const kind = command.startsWith("git,") && command.includes("rev-parse,--show-toplevel") ? "baseline-child-process" : "child-process";
					record({ kind, operation: "Bun." + method, command, stack: stack() });
					return Reflect.apply(target, thisArg, args);
				},
			});
		}
		for (const method of ["spawn", "spawnSync", "exec", "execFile", "fork"]) {
			const original = childProcess[method];
			if (typeof original !== "function") continue;
			childProcess[method] = new Proxy(original, {
				apply(target, thisArg, args) {
					record({ kind: "child-process", operation: "child_process." + method, command: String(args[0]), stack: stack() });
					return Reflect.apply(target, thisArg, args);
				},
			});
		}

		const patchFs = (owner, method, operation) => {
			const original = owner[method];
			if (typeof original !== "function") return;
			owner[method] = new Proxy(original, {
				apply(target, thisArg, args) {
					const rendered = pathText(args[0]);
					if (credentialPath.test(rendered)) record({ kind: "credential", operation, path: rendered, stack: stack() });
					if (disabledState.test(rendered)) record({ kind: operation === "watch" ? "watcher" : "filesystem", operation, path: rendered, stack: stack() });
					return Reflect.apply(target, thisArg, args);
				},
			});
		};
		for (const method of ["readFileSync", "openSync", "writeFileSync", "mkdirSync", "renameSync", "rmSync", "unlinkSync"]) patchFs(fs, method, method);
		for (const method of ["readFile", "open", "writeFile", "mkdir", "rename", "rm", "unlink"]) patchFs(fs.promises, method, method);
		patchFs(fs, "watch", "watch");
		patchFs(fs, "watchFile", "watch");
		syncBuiltinESMExports();

		for (const timer of ["setTimeout", "setInterval", "setImmediate"]) {
			const original = globalThis[timer];
			globalThis[timer] = new Proxy(original, {
				apply(target, thisArg, args) {
					const timerStack = stack();
					if (disabledModule.test(timerStack.replaceAll("\\\\", "/"))) record({ kind: "timer", operation: timer, stack: timerStack });
					return Reflect.apply(target, thisArg, args);
				},
			});
		}

		let ready = false;
		process.stdout.write = new Proxy(process.stdout.write, {
			apply(target, thisArg, args) {
				const text = typeof args[0] === "string" ? args[0] : Buffer.from(args[0]).toString("utf8");
				if (!ready && text.includes('"type":"ready"')) {
					ready = true;
					record({ kind: "ready" });
					setTimeout(() => record({ kind: "idle" }), 750);
				}
				return Reflect.apply(target, thisArg, args);
			},
		});
	`;
	fs.writeFileSync(preloadPath, preloadSource);

	const env = { ...process.env };
	for (const key of Object.keys(env)) {
		if (/(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/iu.test(key)) delete env[key];
	}
	Object.assign(env, {
		HOME: tempRoot,
		NODE_ENV: "test",
		NO_COLOR: "1",
		XDG_CACHE_HOME: path.join(tempRoot, ".cache"),
		XDG_CONFIG_HOME: path.join(tempRoot, ".config"),
		XDG_DATA_HOME: path.join(tempRoot, ".local", "share"),
		XDG_STATE_HOME: path.join(tempRoot, ".local", "state"),
	});
	for (const key of ["OMP_PROFILE", "PI_PROFILE", "PI_CODING_AGENT_DIR", "PI_CONFIG_DIR", "OMP_HOME", "PI_HOME"]) {
		delete env[key];
	}

	const proc = Bun.spawn(
		[
			process.execPath,
			"--preload",
			preloadPath,
			path.join(packageRoot, "src", "cli.ts"),
			"--mode",
			"rpc",
			"--no-session",
			"--no-tools",
			"--no-lsp",
			"--no-extensions",
			"--no-skills",
			"--no-rules",
			"--model",
			"smoke/offline",
		],
		{ cwd: workDir, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
	);
	const stdoutPromise = new Response(proc.stdout).text();
	const stderrPromise = new Response(proc.stderr).text();
	let events: ProbeEvent[] = [];

	try {
		const deadline = Date.now() + 15_000;
		while (Date.now() < deadline && proc.exitCode === null) {
			events = await readEvents(probePath);
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
		expect(events.find(event => event.kind === "instrumented")?.classes).toEqual([
			"network",
			"credential",
			"filesystem",
			"child-process",
			"watcher",
			"timer",
			"persistent-store",
		]);
		expect(events.some(event => event.kind === "local-preconnect")).toBe(true);
		expect(events.some(event => event.kind === "baseline-child-process")).toBe(true);
		expect(
			events.filter(
				event =>
					!["instrumented", "ready", "idle", "local-preconnect", "baseline-child-process"].includes(event.kind),
			),
		).toEqual([]);
		const forbiddenState =
			/(?:^|\/)(?:\.omp|collab|auth-broker|auth-gateway|remote-auth|ssh-control|tts|autoresearch)(?:\/|$)/iu;
		expect(listTree(tempRoot).filter(entry => forbiddenState.test(entry))).toEqual([]);
		expect(listTree(workDir)).toEqual([]);
	} finally {
		if (proc.exitCode === null) {
			proc.kill();
			await proc.exited;
		}
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
}, 25_000);
