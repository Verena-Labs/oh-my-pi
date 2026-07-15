import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentTool } from "@oh-my-pi/pi-agent-core";
import { AuthStorage } from "@oh-my-pi/pi-ai";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { CustomTool } from "@oh-my-pi/pi-coding-agent/extensibility/custom-tools/types";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { removeSyncWithRetries, Snowflake } from "@oh-my-pi/pi-utils";
import { type } from "arktype";

describe("createAgentSession disabled tool boundary", () => {
	let registryDir: string;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	const sessions: AgentSession[] = [];

	beforeAll(async () => {
		registryDir = path.join(os.tmpdir(), `pi-autolearn-active-${Snowflake.next()}`);
		fs.mkdirSync(registryDir, { recursive: true });
		authStorage = await AuthStorage.create(path.join(registryDir, "auth.db"));
		modelRegistry = new ModelRegistry(authStorage);
	});

	afterAll(async () => {
		for (const session of sessions) await session.dispose().catch(() => {});
		authStorage.close();
		if (fs.existsSync(registryDir)) removeSyncWithRetries(registryDir);
	});

	async function activeToolNames(settings: Settings): Promise<string[]> {
		const { session } = await createAgentSession({
			cwd: registryDir,
			agentDir: registryDir,
			modelRegistry,
			sessionManager: SessionManager.inMemory(),
			settings,
			model: getBundledModel("openai", "gpt-4o-mini"),
			disableExtensionDiscovery: true,
			toolNames: ["read"],
		});
		sessions.push(session);
		return session.getActiveToolNames();
	}

	it("does not reactivate manage_skill from legacy settings", async () => {
		const names = await activeToolNames(Settings.isolated({ "autolearn.enabled": true }));
		expect(names).toContain("read");
		expect(names).not.toContain("manage_skill");
	});

	it("still initializes the selected memory backend independently", async () => {
		const { session } = await createAgentSession({
			cwd: registryDir,
			agentDir: registryDir,
			modelRegistry,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({
				"autolearn.enabled": true,
				"memory.backend": "hindsight",
				"hindsight.apiUrl": "http://127.0.0.1:1",
				"hindsight.mentalModelsEnabled": false,
			}),
			model: getBundledModel("openai", "gpt-4o-mini"),
			disableExtensionDiscovery: true,
			toolNames: ["read"],
		});
		sessions.push(session);

		for (let attempt = 0; attempt < 50 && !session.getHindsightSessionState(); attempt++) {
			await Bun.sleep(10);
		}
		expect(session.getHindsightSessionState()).toBeDefined();
		expect(session.getActiveToolNames()).toEqual(
			expect.arrayContaining(["read", "retain", "recall", "reflect", "learn"]),
		);
	});

	it("omits manage_skill from a restricted session when auto-learn is off", async () => {
		const names = await activeToolNames(Settings.isolated({}));
		expect(names).toContain("read");
		expect(names).not.toContain("manage_skill");
	});

	it("does not let SDK custom tools reclaim disabled names", async () => {
		const disabledNames = ["debug", "eval", "github", "manage_skill", "ssh", "tts"];
		const customTools: CustomTool[] = [...disabledNames, "phase3c_probe"].map(name => ({
			name,
			label: name,
			description: `Custom ${name}`,
			parameters: type({}),
			async execute() {
				return { content: [{ type: "text" as const, text: name }] };
			},
		}));
		const { session } = await createAgentSession({
			cwd: registryDir,
			agentDir: registryDir,
			modelRegistry,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({}),
			model: getBundledModel("openai", "gpt-4o-mini"),
			disableExtensionDiscovery: true,
			customTools,
		});
		sessions.push(session);

		const names = session.getActiveToolNames();
		expect(names).toContain("phase3c_probe");
		for (const disabled of disabledNames) expect(names).not.toContain(disabled);
	});

	it("keeps the retained learn implementation across SDK, deferred MCP, and RPC collisions", async () => {
		const replacement = {
			name: "learn",
			label: "Replacement Learn",
			description: "Would replace the narrowed memory operation",
			parameters: type({}),
			strict: true,
			async execute() {
				return { content: [{ type: "text" as const, text: "replacement" }] };
			},
		};
		const { session } = await createAgentSession({
			cwd: registryDir,
			agentDir: registryDir,
			modelRegistry,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({ "memory.backend": "local" }),
			model: getBundledModel("openai", "gpt-4o-mini"),
			disableExtensionDiscovery: true,
			customTools: [replacement],
			extensions: [
				pi => {
					pi.registerTool({ ...replacement, label: "Plugin Replacement Learn" });
				},
			],
		});
		sessions.push(session);

		const retained = session.getToolByName("learn");
		expect(retained?.label).toBe("Learn");
		expect(retained?.description).not.toContain("replace the narrowed");
		await session.reloadPlugins();
		expect(session.getToolByName("learn")).toBe(retained);

		await session.refreshMCPTools([{ ...replacement, mcpServerName: "host", mcpToolName: "learn" }] as never, {
			activateAll: true,
		});
		expect(session.getToolByName("learn")).toBe(retained);

		await expect(session.refreshRpcHostTools([replacement as AgentTool])).rejects.toThrow(
			'RPC host tool "learn" conflicts with an existing tool',
		);
		expect(session.getToolByName("learn")).toBe(retained);
	});
});
