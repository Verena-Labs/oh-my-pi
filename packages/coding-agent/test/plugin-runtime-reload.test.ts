import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import {
	getCapabilityInfo,
	getDisabledProviders,
	getProviderInfo,
	isProviderEnabled,
	registerProvider,
} from "@oh-my-pi/pi-coding-agent/capability";
import { type CustomTool, toolCapability } from "@oh-my-pi/pi-coding-agent/capability/tool";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { loadCapability } from "@oh-my-pi/pi-coding-agent/discovery";
import type { MCPManager } from "@oh-my-pi/pi-coding-agent/mcp/manager";
import { initializeExtensions } from "@oh-my-pi/pi-coding-agent/modes/runtime-init";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import { AgentStorage } from "@oh-my-pi/pi-coding-agent/session/agent-storage";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { ULTRA_THINKING } from "@oh-my-pi/pi-coding-agent/thinking";
import { isSearchProviderExcluded, setExcludedSearchProviders } from "@oh-my-pi/pi-coding-agent/web/search/provider";
import { removeSyncWithRetries, Snowflake } from "@oh-my-pi/pi-utils";

const globalReloadState = globalThis as typeof globalThis & {
	__hotReloadHookVersion?: string;
	__hotReloadStartVersion?: string;
	__hotReloadStartCount?: number;
	__hotReloadShutdownCount?: number;
	__hotReloadCapabilityProbeGate?: Promise<void>;
	__hotReloadCapabilityProbePromise?: Promise<string[]>;
};

function extensionSource(version: string, baseUrl: string): string {
	return `
export default function(pi) {
	const { Type } = pi.typebox;
	pi.registerTool({
		name: "extension_hot",
		label: "Extension Hot",
		description: "extension ${version}",
		parameters: Type.Object({}),
		async execute() { return { content: [{ type: "text", text: "${version}" }] }; },
	});
	pi.registerCommand("extension-hot", {
		description: "extension command ${version}",
		handler: async () => {},
	});
	pi.registerProvider("hot-provider", {
		baseUrl: "${baseUrl}",
		apiKey: "HOT_PROVIDER_KEY",
		api: "openai-completions",
		models: [{
			id: "hot-model",
			name: "Hot Model",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 8192,
			maxTokens: 1024,
		}],
	});
	pi.on("context", async () => {
		globalThis.__hotReloadHookVersion = "${version}";
	});
	pi.on("session_start", async () => {
		globalThis.__hotReloadStartVersion = "${version}";
		globalThis.__hotReloadStartCount = (globalThis.__hotReloadStartCount ?? 0) + 1;
	});
	pi.on("session_shutdown", async () => {
		globalThis.__hotReloadShutdownCount = (globalThis.__hotReloadShutdownCount ?? 0) + 1;
	});
}
`;
}

function customToolSource(version: string): string {
	return `
export default function(api) {
	return {
		name: "custom_hot",
		label: "Custom Hot",
		description: "custom ${version}",
		parameters: api.typebox.Type.Object({}),
		async execute() { return { content: [{ type: "text", text: "${version}" }] }; },
	};
}
`;
}

function customCommandSource(version: string): string {
	return `
export default function() {
	return {
		name: "custom-hot",
		description: "custom command ${version}",
		async execute() { return "${version}"; },
	};
}
`;
}

function capabilityProbeExtensionSource(cwd: string): string {
	return `
import { loadCapability } from "@oh-my-pi/pi-coding-agent/discovery";

export default function() {
	const state = globalThis;
	state.__hotReloadCapabilityProbePromise = (async () => {
		await state.__hotReloadCapabilityProbeGate;
		const result = await loadCapability("tools", { cwd: ${JSON.stringify(cwd)} });
		return result.providers;
	})();
}
`;
}

function ultraListCollisionExtensionSource(): string {
	return `
export default function(pi) {
	const { Type } = pi.typebox;
	pi.registerTool({
		name: "ultra_list",
		label: "Colliding Ultra List",
		description: "plugin collision for ultra_list",
		parameters: Type.Object({}),
		async execute() { return { content: [{ type: "text", text: "plugin collision" }] }; },
	});
}
`;
}

function skillSource(version: string): string {
	return `---
name: hot-skill
description: skill ${version}
---

# Hot skill

Skill body ${version}.
`;
}

describe("runtime plugin reload", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		delete globalReloadState.__hotReloadHookVersion;
		delete globalReloadState.__hotReloadStartVersion;
		delete globalReloadState.__hotReloadStartCount;
		delete globalReloadState.__hotReloadShutdownCount;
		delete globalReloadState.__hotReloadCapabilityProbeGate;
		delete globalReloadState.__hotReloadCapabilityProbePromise;
		setExcludedSearchProviders([]);
		AgentStorage.resetInstance();
		for (const tempDir of tempDirs.splice(0)) removeSyncWithRetries(tempDir);
	});

	test("atomically adopts edited extensions, hooks, tools, commands, skills, and providers", async () => {
		const tempDir = path.join(os.tmpdir(), `pi-plugin-reload-${Snowflake.next()}`);
		tempDirs.push(tempDir);
		const extensionPath = path.join(tempDir, "hot-extension.ts");
		const customToolPath = path.join(tempDir, ".pi", "tools", "hot.ts");
		const customCommandPath = path.join(tempDir, ".pi", "commands", "hot", "index.ts");
		const skillPath = path.join(tempDir, ".pi", "skills", "hot-skill", "SKILL.md");
		const configPath = path.join(tempDir, "config.yml");
		for (const filePath of [extensionPath, customToolPath, customCommandPath, skillPath]) {
			fs.mkdirSync(path.dirname(filePath), { recursive: true });
		}
		fs.writeFileSync(extensionPath, extensionSource("one", "https://one.example/v1"));
		fs.writeFileSync(customToolPath, customToolSource("one"));
		fs.writeFileSync(customCommandPath, customCommandSource("one"));
		fs.writeFileSync(skillPath, skillSource("one"));
		await Bun.write(configPath, JSON.stringify({ temperature: 0.2, providers: { webSearchExclude: [] } }));

		const authStorage = await AuthStorage.create(path.join(tempDir, "auth.db"));
		const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir, "models.yml"));
		const settings = await Settings.loadIsolated({ cwd: tempDir, agentDir: tempDir });
		let failMcpRefresh = false;
		let failedMcpRefreshCalls = 0;
		const mcpManager = {
			getTools: () => {
				if (failMcpRefresh) {
					failedMcpRefreshCalls++;
					throw new Error("synthetic MCP refresh failure");
				}
				return [];
			},
			getServerInstructions: () => new Map<string, string>(),
			getConnectedServers: () => [],
			getServerPrompts: () => [],
		} as unknown as MCPManager;
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			authStorage,
			modelRegistry,
			settings,
			sessionManager: SessionManager.inMemory(tempDir),
			additionalExtensionPaths: [extensionPath],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			mcpManager,
			enableMCP: true,
			enableLsp: false,
			skipPythonPreflight: true,
		});
		await initializeExtensions(session, {
			reportSendError: () => {},
			reportRuntimeError: error => {
				throw new Error(error.error);
			},
		});

		try {
			expect(session.getToolByName("extension_hot")?.description).toBe("extension one");
			expect(session.getToolByName("custom_hot")?.description).toBe("custom one");
			expect(
				session.customCommands.find(command => command.command.name === "custom-hot")?.command.description,
			).toBe("custom command one");
			expect(session.skills.find(skill => skill.name === "hot-skill")?.description).toBe("skill one");
			expect(modelRegistry.find("hot-provider", "hot-model")?.baseUrl).toBe("https://one.example/v1");
			await session.extensionRunner?.emitContext([]);
			expect(globalReloadState.__hotReloadHookVersion).toBe("one");
			expect(globalReloadState.__hotReloadStartVersion).toBe("one");
			expect(globalReloadState.__hotReloadStartCount).toBe(1);
			expect(globalReloadState.__hotReloadShutdownCount ?? 0).toBe(0);

			fs.writeFileSync(extensionPath, extensionSource("two", "https://two.example/v1"));
			fs.writeFileSync(customToolPath, customToolSource("two"));
			fs.writeFileSync(customCommandPath, customCommandSource("two"));
			fs.writeFileSync(skillPath, skillSource("two"));
			await session.reloadPlugins();

			expect(session.getToolByName("extension_hot")?.description).toBe("extension two");
			expect(session.getToolByName("custom_hot")?.description).toBe("custom two");
			expect(session.extensionRunner?.getCommand("extension-hot")?.description).toBe("extension command two");
			expect(
				session.customCommands.find(command => command.command.name === "custom-hot")?.command.description,
			).toBe("custom command two");
			expect(session.skills.find(skill => skill.name === "hot-skill")?.description).toBe("skill two");
			expect(modelRegistry.find("hot-provider", "hot-model")?.baseUrl).toBe("https://two.example/v1");
			await session.extensionRunner?.emitContext([]);
			expect(globalReloadState.__hotReloadHookVersion).toBe("two");
			expect(globalReloadState.__hotReloadStartVersion).toBe("two");
			expect(globalReloadState.__hotReloadStartCount).toBe(2);
			expect(globalReloadState.__hotReloadShutdownCount).toBe(1);

			const reloadGate = Promise.withResolvers<void>();
			const originalPrepareReload = settings.prepareReload.bind(settings);
			const prepareReloadSpy = spyOn(settings, "prepareReload").mockImplementation(async () => {
				await reloadGate.promise;
				return originalPrepareReload();
			});
			const heldReload = session.reloadPlugins();
			let promptSettled = false;
			let customPromptSettled = false;
			const heldPrompt = session.prompt("/extension-hot").finally(() => {
				promptSettled = true;
			});
			const heldCustomPrompt = session
				.promptCustomMessage(
					{ customType: "reload-admission-probe", content: "probe", display: false },
					{ queueOnly: true, streamingBehavior: "followUp" },
				)
				.finally(() => {
					customPromptSettled = true;
				});
			await Bun.sleep(0);
			expect(promptSettled).toBe(false);
			expect(customPromptSettled).toBe(false);
			reloadGate.resolve();
			await heldReload;
			expect(await heldPrompt).toBe(false);
			await heldCustomPrompt;
			session.clearQueue({ forInterrupt: true });
			prepareReloadSpy.mockRestore();
			expect(globalReloadState.__hotReloadStartCount).toBe(3);
			expect(globalReloadState.__hotReloadShutdownCount).toBe(2);

			fs.writeFileSync(extensionPath, "export default function (");
			await Bun.write(configPath, JSON.stringify({ temperature: 0.8, providers: { webSearchExclude: ["codex"] } }));
			await expect(session.reloadPlugins()).rejects.toThrow("Plugin reload rejected");
			expect(session.getToolByName("extension_hot")?.description).toBe("extension two");
			expect(session.extensionRunner?.getCommand("extension-hot")?.description).toBe("extension command two");
			expect(settings.get("temperature")).toBe(0.2);
			expect(isSearchProviderExcluded("codex")).toBe(false);
			await session.extensionRunner?.emitContext([]);
			expect(globalReloadState.__hotReloadHookVersion).toBe("two");
			expect(globalReloadState.__hotReloadStartCount).toBe(3);
			expect(globalReloadState.__hotReloadShutdownCount).toBe(2);

			fs.writeFileSync(extensionPath, extensionSource("three", "https://three.example/v1"));
			const startCountBeforeProviderFailure = globalReloadState.__hotReloadStartCount ?? 0;
			const shutdownCountBeforeProviderFailure = globalReloadState.__hotReloadShutdownCount ?? 0;
			const originalRegisterProvider = modelRegistry.registerProvider.bind(modelRegistry);
			const registerProviderSpy = spyOn(modelRegistry, "registerProvider").mockImplementationOnce(
				(name, config, sourceId) => {
					originalRegisterProvider(name, config, sourceId);
					throw new Error("synthetic provider commit failure");
				},
			);
			await expect(session.reloadPlugins()).rejects.toThrow("synthetic provider commit failure");
			expect(session.getToolByName("extension_hot")?.description).toBe("extension two");
			expect(modelRegistry.find("hot-provider", "hot-model")?.baseUrl).toBe("https://two.example/v1");
			expect(globalReloadState.__hotReloadStartCount).toBe(startCountBeforeProviderFailure);
			expect(globalReloadState.__hotReloadShutdownCount).toBe(shutdownCountBeforeProviderFailure);
			registerProviderSpy.mockRestore();

			const runner = session.extensionRunner;
			if (!runner) throw new Error("expected extension runner");
			const startCountBeforeAdoptionFailure = globalReloadState.__hotReloadStartCount ?? 0;
			const shutdownCountBeforeAdoptionFailure = globalReloadState.__hotReloadShutdownCount ?? 0;
			const adoptSpy = spyOn(runner, "adopt").mockImplementationOnce(() => {
				throw new Error("synthetic adoption failure");
			});
			await expect(session.reloadPlugins()).rejects.toThrow("synthetic adoption failure");
			expect(session.getToolByName("extension_hot")?.description).toBe("extension two");
			expect(modelRegistry.find("hot-provider", "hot-model")?.baseUrl).toBe("https://two.example/v1");
			expect(settings.get("temperature")).toBe(0.2);
			expect(globalReloadState.__hotReloadShutdownCount).toBe(shutdownCountBeforeAdoptionFailure + 1);
			expect(globalReloadState.__hotReloadStartCount).toBe(startCountBeforeAdoptionFailure + 1);
			expect(globalReloadState.__hotReloadStartVersion).toBe("two");
			adoptSpy.mockRestore();

			await session.reloadPlugins();
			expect(settings.get("temperature")).toBe(0.8);
			expect(isSearchProviderExcluded("codex")).toBe(true);
			expect(session.getToolByName("extension_hot")?.description).toBe("extension three");
			expect(modelRegistry.find("hot-provider", "hot-model")?.baseUrl).toBe("https://three.example/v1");

			failMcpRefresh = true;
			fs.writeFileSync(extensionPath, extensionSource("four", "https://four.example/v1"));
			await expect(session.reloadPlugins()).resolves.toBeUndefined();
			expect(session.getToolByName("extension_hot")?.description).toBe("extension four");
			expect(modelRegistry.find("hot-provider", "hot-model")?.baseUrl).toBe("https://four.example/v1");
			expect(failedMcpRefreshCalls).toBe(1);
		} finally {
			await session.dispose();
			authStorage.close();
		}
	});

	test("preserves the active Ultra tool when a reloaded extension declares the same name", async () => {
		const tempDir = path.join(os.tmpdir(), `pi-plugin-reload-ultra-collision-${Snowflake.next()}`);
		tempDirs.push(tempDir);
		const extensionPath = path.join(tempDir, "ultra-collision-extension.ts");
		fs.mkdirSync(tempDir, { recursive: true });
		fs.writeFileSync(extensionPath, "export default function() {}\n");

		const model = getBundledModel("openai", "gpt-5.5");
		if (!model) throw new Error("Expected bundled OpenAI reasoning model");
		const authStorage = await AuthStorage.create(path.join(tempDir, "auth.db"));
		const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir, "models.yml"));
		const settings = await Settings.loadIsolated({ cwd: tempDir, agentDir: tempDir });
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			authStorage,
			modelRegistry,
			settings,
			model,
			sessionManager: SessionManager.inMemory(tempDir),
			additionalExtensionPaths: [extensionPath],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
			skipPythonPreflight: true,
		});
		await initializeExtensions(session, {
			reportSendError: () => {},
			reportRuntimeError: error => {
				throw new Error(error.error);
			},
		});

		try {
			session.setThinkingLevel(ULTRA_THINKING);
			await session.syncUltraPolicy();
			const ultraList = session.getToolByName("ultra_list");
			expect(ultraList).toBeDefined();
			expect(session.getActiveToolNames()).toContain("ultra_list");

			fs.writeFileSync(extensionPath, ultraListCollisionExtensionSource());
			await session.reloadPlugins();

			expect(
				session.extensionRunner?.getAllRegisteredTools().find(tool => tool.definition.name === "ultra_list")
					?.definition.description,
			).toBe("plugin collision for ultra_list");
			expect(session.getToolByName("ultra_list")).toBe(ultraList);
			expect(session.getActiveToolNames()).toContain("ultra_list");
			const result = await session.getToolByName("ultra_list")!.execute("call-ultra-list", {});
			expect(result.content).toContainEqual({
				type: "text",
				text: "No ultra sessions. Spawn one with ultra_spawn.",
			});
			expect(result.details).toEqual({ op: "list", screens: [] });
		} finally {
			await session.dispose();
			authStorage.close();
		}
	});

	test("keeps candidate capability policy request-local during concurrent live loads and rejection", async () => {
		const tempDir = path.join(os.tmpdir(), `pi-plugin-reload-capability-scope-${Snowflake.next()}`);
		tempDirs.push(tempDir);
		const extensionPath = path.join(tempDir, "scope-extension.ts");
		const customToolPath = path.join(tempDir, ".pi", "tools", "scope-tool.ts");
		const configPath = path.join(tempDir, "config.yml");
		fs.mkdirSync(path.dirname(customToolPath), { recursive: true });
		fs.writeFileSync(extensionPath, extensionSource("live", "https://live.example/v1"));
		fs.writeFileSync(customToolPath, customToolSource("live"));
		await Bun.write(configPath, JSON.stringify({ disabledProviders: [] }));

		const authStorage = await AuthStorage.create(path.join(tempDir, "auth.db"));
		const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir, "models.yml"));
		const settings = await Settings.loadIsolated({ cwd: tempDir, agentDir: tempDir });
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			authStorage,
			modelRegistry,
			settings,
			sessionManager: SessionManager.inMemory(tempDir),
			additionalExtensionPaths: [extensionPath],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
			skipPythonPreflight: true,
		});
		await initializeExtensions(session, {
			reportSendError: () => {},
			reportRuntimeError: error => {
				throw new Error(error.error);
			},
		});

		const providerSuffix = Snowflake.next();
		const policyProviderId = `reload-policy-${providerSuffix}`;
		const gateProviderId = `reload-gate-${providerSuffix}`;
		const policyItemPath = path.join(tempDir, "policy-probe.ts");
		const candidateEntered = Promise.withResolvers<void>();
		const releaseCandidateDiscovery = Promise.withResolvers<void>();
		const releaseSpawnedProbe = Promise.withResolvers<void>();
		let providersActive = true;
		let candidateGateConsumed = false;
		let policyProviderLoads = 0;
		let candidateReadSnapshot:
			| {
					disabledProviders: string[];
					isEnabled: boolean;
					providerInfoEnabled: boolean | undefined;
					capabilityInfoEnabled: boolean | undefined;
			  }
			| undefined;

		registerProvider<CustomTool>(toolCapability.id, {
			id: policyProviderId,
			displayName: "Reload policy probe",
			description: "Deterministic provider-policy probe for reload concurrency",
			priority: 10_000,
			load: async ctx => {
				if (!providersActive || ctx.cwd !== tempDir) return { items: [] };
				policyProviderLoads++;
				return {
					items: [
						{
							name: `reload-policy-probe-${providerSuffix}`,
							path: policyItemPath,
							description: "reload policy probe",
							level: "project",
							_source: {
								provider: policyProviderId,
								providerName: "Reload policy probe",
								path: policyItemPath,
								level: "project",
							},
						},
					],
				};
			},
		});
		registerProvider<CustomTool>(toolCapability.id, {
			id: gateProviderId,
			displayName: "Reload discovery gate",
			description: "Holds candidate discovery while a live load runs",
			priority: 9_999,
			load: async ctx => {
				if (!providersActive || ctx.cwd !== tempDir || candidateGateConsumed) return { items: [] };
				candidateGateConsumed = true;
				candidateReadSnapshot = {
					disabledProviders: getDisabledProviders(),
					isEnabled: isProviderEnabled(policyProviderId),
					providerInfoEnabled: getProviderInfo(policyProviderId)?.enabled,
					capabilityInfoEnabled: getCapabilityInfo(toolCapability.id)?.providers.find(
						provider => provider.id === policyProviderId,
					)?.enabled,
				};
				candidateEntered.resolve();
				await releaseCandidateDiscovery.promise;
				return { items: [] };
			},
		});

		try {
			globalReloadState.__hotReloadCapabilityProbeGate = releaseSpawnedProbe.promise;
			fs.writeFileSync(extensionPath, capabilityProbeExtensionSource(tempDir));
			fs.writeFileSync(customToolPath, "export default function (");
			await Bun.write(configPath, JSON.stringify({ disabledProviders: [policyProviderId] }));

			const reloadPromise = session.reloadPlugins();
			void reloadPromise.catch(() => {});
			await candidateEntered.promise;

			// The candidate scope filtered this provider, but a concurrent session
			// load remains on the committed live policy and therefore still sees it.
			expect(candidateReadSnapshot?.disabledProviders).toContain(policyProviderId);
			expect(candidateReadSnapshot?.isEnabled).toBe(false);
			expect(candidateReadSnapshot?.providerInfoEnabled).toBe(false);
			expect(candidateReadSnapshot?.capabilityInfoEnabled).toBe(false);
			expect(getDisabledProviders()).not.toContain(policyProviderId);
			expect(isProviderEnabled(policyProviderId)).toBe(true);
			expect(getProviderInfo(policyProviderId)?.enabled).toBe(true);
			expect(policyProviderLoads).toBe(0);
			const duringCandidate = await loadCapability<CustomTool>(toolCapability.id, { cwd: tempDir });
			expect(duringCandidate.providers).toContain(policyProviderId);
			expect(policyProviderLoads).toBe(1);

			releaseCandidateDiscovery.resolve();
			await expect(reloadPromise).rejects.toThrow("Plugin reload rejected");

			// The candidate extension factory ran before the custom-tool error
			// rejected adoption. Its spawned async task must not inherit candidate
			// policy after rejection, which proves user modules ran outside the scope.
			const spawnedProbe = globalReloadState.__hotReloadCapabilityProbePromise;
			if (!spawnedProbe) throw new Error("candidate extension did not install capability probe");
			releaseSpawnedProbe.resolve();
			expect(await spawnedProbe).toContain(policyProviderId);

			const afterRejection = await loadCapability<CustomTool>(toolCapability.id, { cwd: tempDir });
			expect(afterRejection.providers).toContain(policyProviderId);
			expect(settings.get("disabledProviders")).toEqual([]);
		} finally {
			providersActive = false;
			releaseCandidateDiscovery.resolve();
			releaseSpawnedProbe.resolve();
			await session.dispose();
			authStorage.close();
		}
	});
});
