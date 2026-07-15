import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent, type AgentTool, ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { Model } from "@oh-my-pi/pi-ai";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { ULTRA_THINKING } from "@oh-my-pi/pi-coding-agent/thinking";
import { ULTRA_TOOL_NAMES } from "@oh-my-pi/pi-coding-agent/tools/ultra";
import { UltraSessionRegistry } from "@oh-my-pi/pi-coding-agent/ultra/runtime";
import { TempDir } from "@oh-my-pi/pi-utils";
import { type } from "arktype";

function makeTool(name: string): AgentTool {
	return {
		name,
		label: name,
		description: `Fake ${name}`,
		parameters: type({}),
		async execute() {
			return { content: [{ type: "text" as const, text: "ok" }] };
		},
	};
}

function bundledModel(provider: "anthropic" | "openai", id: string): Model {
	const model = getBundledModel(provider, id);
	if (!model) throw new Error(`Expected bundled model ${provider}/${id}`);
	return model;
}

describe("AgentSession Ultra thinking policy", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	const sessions: AgentSession[] = [];

	beforeEach(async () => {
		tempDir = TempDir.createSync("@pi-ultra-thinking-");
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "auth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		authStorage.setRuntimeApiKey("openai", "test-key");
		modelRegistry = new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml"));
	});

	afterEach(async () => {
		await Promise.all(sessions.splice(0).map(session => session.dispose()));
		authStorage.close();
		tempDir.removeSync();
	});

	function createSession(
		model: Model,
		thinkingLevel: ThinkingLevel | typeof ULTRA_THINKING,
		options: {
			failUltraDeactivation?: boolean;
			registryExtras?: AgentTool[];
			scopedModels?: Array<{ model: Model; thinkingLevel?: ThinkingLevel }>;
			ultraWorker?: boolean;
		} = {},
	): {
		session: AgentSession;
		sessionManager: SessionManager;
		settings: Settings;
	} {
		const baseTool = makeTool("base_tool");
		const registryTools = [baseTool, ...(options.registryExtras ?? [])];
		const agent = new Agent({
			initialState: {
				model,
				systemPrompt: ["Test"],
				tools: [baseTool],
				messages: [],
				thinkingLevel: ThinkingLevel.High,
			},
		});
		const sessionManager = SessionManager.inMemory();
		const settings = Settings.isolated();
		const session = new AgentSession({
			agent,
			sessionManager,
			settings,
			modelRegistry,
			thinkingLevel,
			ultraWorker: options.ultraWorker,
			scopedModels: options.scopedModels,
			toolRegistry: new Map(registryTools.map(tool => [tool.name, tool] as const)),
			builtInToolNames: [baseTool.name],
			createUltraTools: () => ULTRA_TOOL_NAMES.map(makeTool),
			rebuildSystemPrompt: async toolNames => {
				if (options.failUltraDeactivation && !toolNames.includes("ultra_spawn")) {
					throw new Error("synthetic Ultra deactivation rebuild failure");
				}
				return { systemPrompt: ["Test"] };
			},
		});
		sessions.push(session);
		return { session, sessionManager, settings };
	}

	it("keeps Ultra configured while clamping provider effort and preserving base tools", async () => {
		const model = bundledModel("anthropic", "claude-sonnet-4-6");
		const { session } = createSession(model, ULTRA_THINKING);

		await session.syncUltraPolicy();

		expect(session.configuredThinkingLevel()).toBe(ULTRA_THINKING);
		expect(session.thinkingLevel).toBe(ThinkingLevel.High);
		expect(session.agent.state.thinkingLevel).toBe(ThinkingLevel.High);
		expect(session.getActiveToolNames()).toContain("base_tool");
		for (const name of ULTRA_TOOL_NAMES) expect(session.getActiveToolNames()).toContain(name);
	});

	it("injects the player-coach contract together with the Ultra tools", async () => {
		const model = bundledModel("openai", "gpt-5.5");
		const { session } = createSession(model, ULTRA_THINKING);
		const promptSpy = vi.spyOn(session.agent, "prompt").mockResolvedValue(undefined);

		await session.prompt("finish the implementation");

		const promptMessages = promptSpy.mock.calls[0]?.[0] as unknown as Array<{
			content?: string;
			customType?: string;
		}>;
		const ultraContext = promptMessages.find(message => message.customType === "ultra-thinking-context");
		expect(ultraContext?.content).toContain("continue useful work yourself");
		expect(ultraContext?.content).toContain("resolve shared-workspace conflicts");
		expect(ultraContext?.content).toContain("run final verification");
		for (const name of ULTRA_TOOL_NAMES) {
			expect(session.getActiveToolNames()).toContain(name);
			expect(ultraContext?.content).toContain(`\`${name}\``);
		}
	});

	it("keeps the primary player-coach context out of private Ultra workers", async () => {
		const model = bundledModel("openai", "gpt-5.5");
		const { session } = createSession(model, ULTRA_THINKING, { ultraWorker: true });
		const promptSpy = vi.spyOn(session.agent, "prompt").mockResolvedValue(undefined);

		await session.prompt("complete the bounded workstream");

		const promptMessages = promptSpy.mock.calls[0]?.[0] as unknown as Array<{ customType?: string }>;
		expect(promptMessages.some(message => message.customType === "ultra-thinking-context")).toBe(false);
		for (const name of ULTRA_TOOL_NAMES) expect(session.getActiveToolNames()).toContain(name);
	});

	it("persists the configured sentinel and removes only Ultra tools on exit", async () => {
		const model = bundledModel("openai", "gpt-5.5");
		const { session, sessionManager } = createSession(model, ThinkingLevel.High);

		session.setThinkingLevel(ULTRA_THINKING);
		await session.syncUltraPolicy();
		const ultraEntry = sessionManager.getBranch().findLast(entry => entry.type === "thinking_level_change");
		expect(ultraEntry?.type).toBe("thinking_level_change");
		if (ultraEntry?.type === "thinking_level_change") {
			expect(ultraEntry.thinkingLevel).toBe(ThinkingLevel.XHigh);
			expect(ultraEntry.configured).toBe(ULTRA_THINKING);
		}

		const killAllSpy = vi.spyOn(UltraSessionRegistry.global(), "killAll");
		try {
			session.setThinkingLevel(ThinkingLevel.XHigh);
			await session.syncUltraPolicy();
			expect(killAllSpy).toHaveBeenCalledTimes(1);
		} finally {
			killAllSpy.mockRestore();
		}

		expect(session.configuredThinkingLevel()).toBe(ThinkingLevel.XHigh);
		expect(session.getActiveToolNames()).toEqual(["base_tool"]);
		for (const name of ULTRA_TOOL_NAMES) expect(session.getToolByName(name)).toBeUndefined();
	});

	it("serializes rapid enable-disable changes with the latest selector winning", async () => {
		const model = bundledModel("openai", "gpt-5.5");
		const { session } = createSession(model, ThinkingLevel.High);

		session.setThinkingLevel(ULTRA_THINKING);
		session.setThinkingLevel(ThinkingLevel.XHigh);
		await session.syncUltraPolicy();

		expect(session.configuredThinkingLevel()).toBe(ThinkingLevel.XHigh);
		expect(session.getActiveToolNames()).toEqual(["base_tool"]);
	});

	it("rolls back the configured tier when orchestration activation fails", async () => {
		const model = bundledModel("openai", "gpt-5.5");
		const collision = makeTool("ultra_spawn");
		const { session, sessionManager, settings } = createSession(model, ThinkingLevel.High, {
			registryExtras: [collision],
		});

		session.setThinkingLevel(ULTRA_THINKING, true);
		await expect(session.syncUltraPolicy()).rejects.toThrow(
			'Ultra tool "ultra_spawn" conflicts with an existing tool.',
		);

		expect(session.configuredThinkingLevel()).toBe(ThinkingLevel.High);
		expect(session.thinkingLevel).toBe(ThinkingLevel.High);
		expect(settings.get("defaultThinkingLevel")).toBe(ThinkingLevel.High);
		expect(session.getActiveToolNames()).toEqual(["base_tool"]);
		expect(session.getToolByName("ultra_spawn")).toBe(collision);
		const restoredEntry = sessionManager.getBranch().findLast(entry => entry.type === "thinking_level_change");
		expect(restoredEntry?.type).toBe("thinking_level_change");
		if (restoredEntry?.type === "thinking_level_change") {
			expect(restoredEntry.thinkingLevel).toBe(ThinkingLevel.High);
			expect(restoredEntry.configured).toBe(ThinkingLevel.High);
		}
	});

	it("keeps Ultra coherent when orchestration deactivation fails", async () => {
		const model = bundledModel("openai", "gpt-5.5");
		const { session, settings } = createSession(model, ThinkingLevel.High, {
			failUltraDeactivation: true,
		});
		session.setThinkingLevel(ULTRA_THINKING, true);
		await session.syncUltraPolicy();

		session.setThinkingLevel(ThinkingLevel.XHigh, true);
		await expect(session.syncUltraPolicy()).rejects.toThrow("synthetic Ultra deactivation rebuild failure");

		expect(session.configuredThinkingLevel()).toBe(ULTRA_THINKING);
		expect(settings.get("defaultThinkingLevel")).toBe(ULTRA_THINKING);
		for (const name of ULTRA_TOOL_NAMES) expect(session.getActiveToolNames()).toContain(name);
	});

	it("preserves Ultra across scoped and role model changes", async () => {
		const firstModel = bundledModel("anthropic", "claude-sonnet-4-5");
		const secondModel = bundledModel("anthropic", "claude-sonnet-4-6");
		const { session } = createSession(firstModel, ULTRA_THINKING, {
			scopedModels: [
				{ model: firstModel, thinkingLevel: ThinkingLevel.Off },
				{ model: secondModel, thinkingLevel: ThinkingLevel.Off },
			],
		});
		await session.syncUltraPolicy();

		const scopedResult = await session.cycleModel();
		await session.syncUltraPolicy();
		expect(scopedResult?.model.id).toBe(secondModel.id);
		expect(session.configuredThinkingLevel()).toBe(ULTRA_THINKING);
		expect(session.thinkingLevel).not.toBe(ThinkingLevel.Off);

		await session.applyRoleModel({
			role: "default",
			model: firstModel,
			thinkingLevel: ThinkingLevel.Off,
			explicitThinkingLevel: true,
		});
		await session.syncUltraPolicy();
		expect(session.model?.id).toBe(firstModel.id);
		expect(session.configuredThinkingLevel()).toBe(ULTRA_THINKING);
		expect(session.thinkingLevel).not.toBe(ThinkingLevel.Off);
		for (const name of ULTRA_TOOL_NAMES) expect(session.getActiveToolNames()).toContain(name);
	});

	it("clears the worker roster at a new transcript boundary without leaving Ultra", async () => {
		const model = bundledModel("openai", "gpt-5.5");
		const { session } = createSession(model, ULTRA_THINKING);
		await session.syncUltraPolicy();
		const killAllSpy = vi.spyOn(UltraSessionRegistry.global(), "killAll");

		await expect(session.newSession()).resolves.toBe(true);

		expect(killAllSpy).toHaveBeenCalledTimes(1);
		expect(session.configuredThinkingLevel()).toBe(ULTRA_THINKING);
		for (const name of ULTRA_TOOL_NAMES) expect(session.getActiveToolNames()).toContain(name);
	});

	it("rejects Ultra when the model has no controllable reasoning effort", () => {
		const model = bundledModel("openai", "gpt-4o-mini");
		const { session } = createSession(model, ThinkingLevel.Off);

		expect(() => session.setThinkingLevel(ULTRA_THINKING)).toThrow(
			"Ultra requires a model with controllable reasoning effort.",
		);
		expect(session.configuredThinkingLevel()).toBe(ThinkingLevel.Off);
	});
});
