/**
 * Contracts: /delegate mode toggle on InteractiveMode.
 *
 * 1. Delegate tools do not exist in the session registry before the mode is entered.
 * 2. Entering registers and activates exactly `read` plus the delegate tools.
 * 3. Exiting unregisters the delegate tools and restores the pre-delegate active toolset
 *    exactly, including the legitimate empty set.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent, type AgentTool } from "@oh-my-pi/pi-agent-core";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { InteractiveMode } from "@oh-my-pi/pi-coding-agent/modes/interactive-mode";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { BUILTIN_SLASH_COMMAND_DEFS } from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";
import { DELEGATE_TOOL_NAMES } from "@oh-my-pi/pi-coding-agent/tools/delegate";
import { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";
import { TempDir } from "@oh-my-pi/pi-utils";
import { type } from "arktype";

function stubTool(name: string): AgentTool {
	return {
		name,
		label: name,
		description: `${name} tool`,
		parameters: type({ value: "string" }),
		strict: true,
		async execute() {
			return { content: [{ type: "text", text: `${name} executed` }] };
		},
	};
}

describe("InteractiveMode delegate mode toggle", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let session: AgentSession;
	let mode: InteractiveMode;

	beforeAll(async () => {
		await initTheme();
	});

	beforeEach(async () => {
		resetSettingsForTest();
		tempDir = TempDir.createSync("@pi-delegate-toggle-");
		await Settings.init({ inMemory: true, cwd: tempDir.path() });
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		const modelRegistry = new ModelRegistry(authStorage);
		const model = modelRegistry.find("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected claude-sonnet-4-5 to exist in registry");

		const registryTools = [stubTool("read")];

		session = new AgentSession({
			agent: new Agent({
				initialState: {
					model,
					systemPrompt: ["Test"],
					tools: [],
					messages: [],
				},
			}),
			sessionManager: SessionManager.create(tempDir.path(), tempDir.path()),
			settings: Settings.isolated({}),
			modelRegistry,
			toolRegistry: new Map(registryTools.map(tool => [tool.name, tool])),
			createDelegateTools: () => DELEGATE_TOOL_NAMES.map(stubTool),
		});
		mode = new InteractiveMode(session, "test", undefined, undefined, undefined, undefined, new EventBus());
	});

	afterEach(async () => {
		mode?.stop();
		await session?.dispose();
		authStorage?.close();
		tempDir?.removeSync();
		vi.restoreAllMocks();
		resetSettingsForTest();
	});

	it("advertises only the public /delegate command name", () => {
		const commands = BUILTIN_SLASH_COMMAND_DEFS.map(command => command.name);
		expect(commands).toContain("delegate");
		expect(commands).not.toContain("vibe");
	});

	it("resumes a legacy vibe marker as Delegate and persists only the new marker", async () => {
		session.sessionManager.appendModeChange("vibe");

		await mode.init({ suppressWelcomeIntro: true });

		expect(mode.delegateModeEnabled).toBe(true);
		const modeEntries = session.sessionManager.getEntries().filter(entry => entry.type === "mode_change");
		expect(modeEntries.at(-1)).toMatchObject({ type: "mode_change", mode: "delegate" });
		expect(session.getAllToolNames().filter(name => name.startsWith("vibe_"))).toEqual([]);
	});

	it("restores the exact pre-delegate toolset on exit, including an empty one", async () => {
		expect(session.getAllToolNames()).toEqual(["read"]);
		expect(session.getActiveToolNames()).toEqual([]);

		await mode.handleDelegateModeCommand();
		expect(mode.delegateModeEnabled).toBe(true);
		const inMode = session.getActiveToolNames();
		expect(inMode).toContain("read");
		for (const name of DELEGATE_TOOL_NAMES) {
			expect(inMode).toContain(name);
		}
		expect(inMode.toSorted()).toEqual(["read", ...DELEGATE_TOOL_NAMES].toSorted());
		expect(session.getAllToolNames().toSorted()).toEqual(["read", ...DELEGATE_TOOL_NAMES].toSorted());
		expect(session.getAllToolNames().filter(name => name.startsWith("vibe_"))).toEqual([]);

		// Toggle off: the empty previous toolset must come back — delegate tools
		// must not leak past the mode.
		await mode.handleDelegateModeCommand();
		expect(mode.delegateModeEnabled).toBe(false);
		expect(session.getActiveToolNames()).toEqual([]);
		expect(session.getAllToolNames()).toEqual(["read"]);
	});
});
