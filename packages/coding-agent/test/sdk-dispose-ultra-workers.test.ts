import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { Snowflake, TempDir } from "@oh-my-pi/pi-utils";

describe("SDK Ultra-worker disposal", () => {
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;

	beforeAll(async () => {
		authStorage = await AuthStorage.create(":memory:");
		modelRegistry = new ModelRegistry(authStorage);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	afterAll(() => {
		authStorage.close();
	});

	it("forwards an explicit Ultra preservation disposition to AgentSession.dispose", async () => {
		using tempDir = TempDir.createSync("@omp-sdk-dispose-ultra-");
		const disposeSpy = vi.spyOn(AgentSession.prototype, "dispose");
		const agentId = `UltraDispose-${Snowflake.next()}`;
		const { session } = await createAgentSession({
			cwd: tempDir.path(),
			agentDir: tempDir.path(),
			modelRegistry,
			model: getBundledModel("openai", "gpt-4o-mini"),
			settings: Settings.isolated(),
			sessionManager: SessionManager.inMemory(),
			agentRegistry: new AgentRegistry(),
			agentId,
			agentDisplayName: "ultra",
			taskDepth: 1,
			parentTaskPrefix: agentId,
			disableExtensionDiscovery: true,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
			rules: [],
			workspaceTree: {
				rootPath: tempDir.path(),
				rendered: "",
				truncated: false,
				totalLines: 0,
				agentsMdFiles: [],
			},
		});

		await session.dispose({ ultraWorkers: "park" });

		expect(disposeSpy).toHaveBeenCalledTimes(1);
		expect(disposeSpy).toHaveBeenCalledWith({ ultraWorkers: "park" });
	});
});
