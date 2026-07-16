import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus";
import { AgentHubOverlayComponent } from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub";
import { SessionObserverRegistry } from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { type AgentRef, AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { runSubprocess } from "@oh-my-pi/pi-coding-agent/task/executor";
import type { AgentDefinition } from "@oh-my-pi/pi-coding-agent/task/types";
import { UltraSessionRegistry } from "@oh-my-pi/pi-coding-agent/ultra/runtime";
import { getAgentDir, logger, Snowflake, setAgentDir, TempDir } from "@oh-my-pi/pi-utils";

describe("SDK Ultra startup registration", () => {
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;

	beforeAll(async () => {
		authStorage = await AuthStorage.create(":memory:");
		authStorage.setRuntimeApiKey("openai", "test-key");
		modelRegistry = new ModelRegistry(authStorage);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		UltraSessionRegistry.resetGlobalForTests();
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
	});

	afterAll(() => {
		authStorage.close();
	});

	it("routes a Hub kill through Ultra while the SDK ref is still sessionless", async () => {
		using tempDir = TempDir.createSync("@omp-sdk-ultra-preregister-");
		const previousAgentDir = getAgentDir();
		setAgentDir(tempDir.path());
		logger.setTransports({ file: `${tempDir.path()}/logs`, console: false });
		const id = `UltraStarting-${Snowflake.next()}`;
		const model = getBundledModel("openai", "gpt-4o-mini");
		if (!model) throw new Error("Expected bundled gpt-4o-mini model");
		const agent: AgentDefinition = {
			name: "ultra",
			description: "startup registration test",
			systemPrompt: "Yield after the test allows startup to continue.",
			source: "bundled",
		};
		const abortController = new AbortController();
		const registry = AgentRegistry.global();
		const registered = Promise.withResolvers<AgentRef>();
		let hub: AgentHubOverlayComponent | undefined;

		const killSpy = vi.spyOn(UltraSessionRegistry.global(), "killRegistered").mockImplementation(async workerId => {
			expect(workerId).toBe(id);
			abortController.abort("killed during Ultra startup");
			return { id: workerId, cancelledTurn: true };
		});
		const unsubscribe = registry.onChange(event => {
			if (event.type !== "registered" || event.ref.id !== id) return;
			registered.resolve(event.ref);
			hub = new AgentHubOverlayComponent({
				observers: new SessionObserverRegistry(),
				hubKeys: [],
				onDone: () => {},
				requestRender: () => {},
				registry,
				irc: new IrcBus(registry),
				focusAgent: async () => {},
			});
			hub.handleInput("x");
			// Keep the regression deterministic: on the broken Task-routing branch,
			// stop startup before it can reach a real provider request.
			queueMicrotask(() => {
				if (!abortController.signal.aborted) abortController.abort("test cleanup after misrouted startup kill");
			});
		});

		try {
			const run = runSubprocess({
				cwd: tempDir.path(),
				agent,
				task: "Wait for startup routing.",
				index: 0,
				id,
				parentAgentId: "Main",
				modelOverride: `${model.provider}/${model.id}`,
				modelRegistry,
				settings: Settings.isolated(),
				ultraWorker: true,
				enableLsp: false,
				signal: abortController.signal,
				contextFiles: [],
				skills: [],
				promptTemplates: [],
				workspaceTree: {
					rootPath: tempDir.path(),
					rendered: "",
					truncated: false,
					totalLines: 0,
					agentsMdFiles: [],
				},
				rules: [],
				preloadedExtensionPaths: [],
				preloadedCustomToolPaths: [],
			});

			const ref = await registered.promise;
			expect(ref).toMatchObject({
				id,
				kind: "sub",
				workerKind: "ultra",
				status: "running",
				session: null,
			});
			expect(killSpy).toHaveBeenCalledTimes(1);

			const result = await run;
			expect(result.exitCode).toBe(1);
			expect(result.aborted).toBe(true);

			// `runSubprocess` disposes a session that finishes constructing after the
			// abort race; wait for that background cleanup before ending the test.
			for (let attempt = 0; attempt < 100 && registry.get(id); attempt++) await Bun.sleep(5);
			expect(registry.get(id)).toBeUndefined();
		} finally {
			unsubscribe();
			hub?.dispose();
			logger.setTransports({ file: false, console: false });
			setAgentDir(previousAgentDir);
		}
	});
});
