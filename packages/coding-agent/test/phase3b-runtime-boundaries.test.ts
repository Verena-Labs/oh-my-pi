import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { Agent, type AgentTool } from "@oh-my-pi/pi-agent-core";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { commands, resolveCliArgv } from "@oh-my-pi/pi-coding-agent/cli-commands";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { hasUi } from "@oh-my-pi/pi-coding-agent/config/settings-schema";
import { buildSessionData } from "@oh-my-pi/pi-coding-agent/export/html";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { BUILTIN_SLASH_COMMAND_DEFS } from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";
import { buildSystemPrompt } from "@oh-my-pi/pi-coding-agent/system-prompt";
import { TempDir } from "@oh-my-pi/pi-utils";
import { type } from "arktype";
import { TtsrManager } from "../src/export/ttsr";
import { expandSlashCommand } from "../src/extensibility/slash-commands";
import { SecretObfuscator } from "../src/secrets/obfuscator";
import { COMPACT_MODES, parseCompactArgs } from "../src/session/compact-modes";

describe("Pi Phase 3B runtime boundaries", () => {
	test("legacy settings and runtime overrides cannot change locked Pi policy", () => {
		const settings = Settings.isolated({
			"contextPromotion.enabled": true,
			"compaction.strategy": "snapcompact",
			"compaction.remoteEnabled": false,
			"compaction.remoteStreamingV2Enabled": false,
			"compaction.supersedeReads": true,
			"compaction.dropUseless": true,
			"branchSummary.enabled": true,
			"recap.enabled": true,
			"retry.modelFallback": true,
			"retry.fallbackChains": { default: ["anthropic/other"] },
			"providers.anthropic.serverSideFallback": true,
			"features.unexpectedStopDetection": true,
			"secrets.enabled": true,
		});

		expect(settings.get("contextPromotion.enabled")).toBe(false);
		expect(settings.get("compaction.strategy")).toBe("context-full");
		// Provider-native compaction is an internal Pi baseline path. Its settings
		// stay hidden/locked even though the transport itself remains enabled.
		expect(settings.get("compaction.remoteEnabled")).toBe(true);
		expect(settings.get("compaction.remoteStreamingV2Enabled")).toBe(true);
		expect(settings.get("compaction.supersedeReads")).toBe(false);
		expect(settings.get("compaction.dropUseless")).toBe(false);
		expect(settings.get("branchSummary.enabled")).toBe(false);
		expect(settings.get("recap.enabled")).toBe(false);
		expect(settings.get("retry.modelFallback")).toBe(false);
		expect(settings.get("retry.fallbackChains")).toEqual({});
		expect(settings.get("providers.anthropic.serverSideFallback")).toBe(false);
		expect(settings.get("features.unexpectedStopDetection")).toBe(false);
		expect(settings.get("secrets.enabled")).toBe(false);
		expect(settings.isConfigured("compaction.strategy")).toBe(false);
		expect(settings.isConfigured("compaction.remoteEnabled")).toBe(false);
		expect(settings.isConfigured("compaction.remoteStreamingV2Enabled")).toBe(false);
		expect(hasUi("compaction.strategy")).toBe(false);
		expect(hasUi("compaction.remoteEnabled")).toBe(false);
		expect(hasUi("compaction.remoteStreamingV2Enabled")).toBe(false);
		expect(() => settings.set("compaction.strategy", "snapcompact")).toThrow("unavailable in Pi");
		expect(() => settings.set("compaction.remoteEnabled", false)).toThrow("unavailable in Pi");
		expect(() => settings.override("compaction.remoteStreamingV2Enabled", false)).toThrow("unavailable in Pi");
		expect(() => settings.override("retry.modelFallback", true)).toThrow("unavailable in Pi");
	});

	test("folder-scoped provider/model entries are ignored while plain selections remain", () => {
		const settings = Settings.isolated({
			enabledModels: ["openai-codex/gpt-5", { path: "/tmp/project", models: ["anthropic/other"] }],
			disabledProviders: ["legacy-disabled", { pathPrefix: "/tmp/project", providers: ["anthropic"] }],
		});

		expect(settings.get("enabledModels")).toEqual(["openai-codex/gpt-5"]);
		expect(settings.get("disabledProviders")).toEqual(["legacy-disabled"]);
	});

	test("extra compaction and session commands are absent and reserved", () => {
		expect(COMPACT_MODES).toEqual([]);
		expect(parseCompactArgs("snapcompact")).toEqual({ instructions: "snapcompact" });

		const byName = new Map(BUILTIN_SLASH_COMMAND_DEFS.map(command => [command.name, command]));
		for (const disabled of ["drop", "fresh", "handoff", "move", "retry", "shake", "tree"]) {
			expect(byName.has(disabled)).toBe(false);
		}
		expect(byName.get("session")?.subcommands?.map(command => command.name)).toEqual(["info"]);
		for (const retained of ["compact", "resume", "export", "fork"]) {
			expect(byName.has(retained)).toBe(true);
		}
	});

	test("extra session operations fail before touching session state", async () => {
		const inert = {} as AgentSession;
		expect(AgentSession.prototype.freshSession.call(inert)).toBeUndefined();
		expect(await AgentSession.prototype.retry.call(inert)).toBe(false);
		await expect(AgentSession.prototype.dropImages.call(inert)).rejects.toThrow("unavailable in Pi");
		await expect(AgentSession.prototype.shake.call(inert, "images")).rejects.toThrow("unavailable in Pi");
		await expect(AgentSession.prototype.handoff.call(inert)).rejects.toThrow("unavailable in Pi");
		await expect(AgentSession.prototype.navigateTree.call(inert, "entry-id")).rejects.toThrow("unavailable in Pi");

		const manager = SessionManager.inMemory("/tmp/pi-phase3b");
		await expect(manager.moveTo("/tmp/other-project")).rejects.toThrow("unavailable in Pi");
		await expect(manager.dropSession("/tmp/session.jsonl")).rejects.toThrow("unavailable in Pi");
	});

	test("drop-style newSession is inert before hooks, reset, or session-manager access", async () => {
		const accessed: string[] = [];
		const inert = new Proxy({} as AgentSession, {
			get(_target, property) {
				accessed.push(String(property));
				throw new Error(`drop-style newSession accessed ${String(property)}`);
			},
		});

		expect(await AgentSession.prototype.newSession.call(inert, { drop: true })).toBe(false);
		expect(accessed).toEqual([]);
	});

	test("credential-pool and remote-broker CLI back doors are not registered", () => {
		const names = commands.map(command => command.name);
		for (const disabled of ["auth-broker", "auth-gateway", "dry-balance", "token"]) {
			expect(names).not.toContain(disabled);
			expect(resolveCliArgv([disabled])).toEqual({ error: expect.stringContaining("not available in Pi") });
		}
		for (const retained of ["models", "usage", "bench", "tiny-models"]) {
			expect(names).toContain(retained);
		}
	});

	test("basic exports serialize only the active branch", () => {
		const manager = SessionManager.inMemory("/tmp/pi-phase3b-export");
		const rootId = manager.appendMessage({ role: "user", content: "root", timestamp: 1 });
		manager.appendMessage({ role: "user", content: "abandoned branch", timestamp: 2 });
		manager.branch(rootId);
		manager.appendMessage({ role: "user", content: "active branch", timestamp: 3 });

		const data = buildSessionData(manager);
		expect(manager.getEntries()).toHaveLength(3);
		expect(data.entries).toHaveLength(2);
		expect(JSON.stringify(data.entries)).toContain("active branch");
		expect(JSON.stringify(data.entries)).not.toContain("abandoned branch");
		expect(data.subSessions).toBeUndefined();
	});

	test("direct system-prompt construction ignores dormant rulebook inputs", async () => {
		const marker = "PI_DISABLED_RULE_INPUT_MARKER";
		const { systemPrompt } = await buildSystemPrompt({
			cwd: "/tmp/pi-phase3b-system-prompt",
			customPrompt: "Base prompt",
			contextFiles: [],
			skills: [],
			toolNames: [],
			rules: [{ name: "disabled", description: marker, path: "/tmp/disabled.md" }],
			alwaysApplyRules: [{ name: "disabled", content: marker, path: "/tmp/disabled.md" }],
		});
		const text = systemPrompt.join("\n");
		expect(text).not.toContain(marker);
		expect(text).not.toContain("rule://");
	});

	test("direct AgentSession construction cannot inject rulebooks or outbound obfuscation", async () => {
		const tempDir = TempDir.createSync("@pi-phase3b-session-policy-");
		const authStorage = await AuthStorage.create(path.join(tempDir.path(), "auth.db"));
		const modelRegistry = new ModelRegistry(authStorage);
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled test model");
		let disabledCommandRuns = 0;
		let allowedCommandRuns = 0;
		const session = new AgentSession({
			agent: new Agent({ initialState: { model, systemPrompt: ["test"], tools: [], messages: [] } }),
			sessionManager: SessionManager.inMemory(tempDir.path()),
			settings: Settings.isolated(),
			modelRegistry,
			ttsrManager: new TtsrManager(),
			obfuscator: new SecretObfuscator([{ type: "plain", content: "should-stay-plain" }]),
			slashCommands: [
				{ name: "move", description: "disabled", content: "disabled", source: "test" },
				{ name: "file:allowed", description: "allowed", content: "allowed", source: "test" },
			],
			customCommands: [
				{
					path: "disabled.ts",
					resolvedPath: "disabled.ts",
					source: "project",
					command: {
						name: "retry",
						description: "disabled",
						execute: () => {
							disabledCommandRuns++;
						},
					},
				},
				{
					path: "allowed.ts",
					resolvedPath: "allowed.ts",
					source: "project",
					command: {
						name: "custom:allowed",
						description: "allowed",
						execute: () => {
							allowedCommandRuns++;
						},
					},
				},
			],
		});

		try {
			expect(session.ttsrManager).toBeUndefined();
			expect(session.obfuscator).toBeUndefined();

			expect(session.customCommands.map(command => command.command.name)).toEqual(["custom:allowed"]);
			await expect(session.prompt("/retry")).rejects.toThrow("unavailable in Pi");
			await expect(session.prompt("/ssh:connect")).rejects.toThrow("unavailable in Pi");
			expect(disabledCommandRuns).toBe(0);
			await expect(session.prompt("/custom:allowed")).resolves.toBe(false);
			expect(allowedCommandRuns).toBe(1);

			session.setMCPPromptCommands([
				{
					path: "mcp:ssh/prompt",
					resolvedPath: "mcp:ssh/prompt",
					source: "bundled",
					command: { name: "ssh:prompt", description: "disabled", execute: () => undefined },
				},
				{
					path: "mcp:server/allowed",
					resolvedPath: "mcp:server/allowed",
					source: "bundled",
					command: { name: "server:allowed", description: "allowed", execute: () => undefined },
				},
			]);
			expect(session.mcpPromptCommands.map(command => command.command.name)).toEqual(["server:allowed"]);

			const parameters = type({});
			const tool = (name: string): AgentTool => ({
				name,
				label: name,
				description: name,
				parameters,
				strict: true,
				execute: async () => ({ content: [{ type: "text", text: name }] }),
			});
			await session.refreshMCPTools([
				{ ...tool("eval"), mcpServerName: "server", mcpToolName: "eval" },
				{ ...tool("mcp__server_allowed"), mcpServerName: "server", mcpToolName: "allowed" },
			] as never);
			expect(session.getToolByName("eval")).toBeUndefined();
			expect(session.getToolByName("mcp__server_allowed")).toBeDefined();

			await session.refreshRpcHostTools([tool("debug"), tool("host_allowed")]);
			expect(session.getToolByName("debug")).toBeUndefined();
			expect(session.getToolByName("host_allowed")).toBeDefined();
			expect(session.getActiveToolNames()).toContain("host_allowed");

			expect(
				expandSlashCommand("/move now", [
					{ name: "move", description: "disabled", content: "expanded $ARGUMENTS", source: "test" },
				]),
			).toBe("/move now");
			expect(
				expandSlashCommand("/file:allowed now", [
					{ name: "file:allowed", description: "allowed", content: "expanded $ARGUMENTS", source: "test" },
				]),
			).toBe("expanded now");
		} finally {
			await session.dispose();
			authStorage.close();
			tempDir.removeSync();
		}
	});
});
