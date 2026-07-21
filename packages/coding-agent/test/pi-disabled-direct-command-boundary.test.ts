import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { TempDir } from "@oh-my-pi/pi-utils";
import { resetSettingsForTest, Settings, settings } from "../src/config/settings";
import { CommandController } from "../src/modes/controllers/command-controller";
import { OmfgController } from "../src/modes/controllers/omfg-controller";
import { SSHCommandController } from "../src/modes/controllers/ssh-command-controller";
import { TanCommandController } from "../src/modes/controllers/tan-command-controller";
import { InteractiveMode } from "../src/modes/interactive-mode";
import { initTheme } from "../src/modes/theme/theme";
import type { InteractiveModeContext } from "../src/modes/types";
import type { AgentSession } from "../src/session/agent-session";
import { SessionManager } from "../src/session/session-manager";

let mode: InteractiveMode | undefined;
let tempDir: TempDir | undefined;

beforeAll(async () => {
	await initTheme(false);
});

afterEach(() => {
	mode?.stop();
	mode = undefined;
	tempDir?.removeSync();
	tempDir = undefined;
	vi.restoreAllMocks();
	resetSettingsForTest();
});

describe("Pi disabled direct command boundary", () => {
	it("keeps publicly constructible dormant controllers inert before they touch their context", async () => {
		const accessed: string[] = [];
		const ctx = new Proxy(
			{},
			{
				get(_target, property) {
					accessed.push(String(property));
					throw new Error(`disabled controller accessed ctx.${String(property)}`);
				},
			},
		) as InteractiveModeContext;

		await new CommandController(ctx).handleDropCommand();
		await new CommandController(ctx).handleMoveCommand("/tmp");
		await new SSHCommandController(ctx).handle("/ssh help");
		await new TanCommandController(ctx).start("start a background job");
		await new OmfgController(ctx).start("write a rule");

		expect(accessed).toEqual([]);
	});

	it("makes the InteractiveMode façade a no-op before UI, session, model, job, or filesystem dispatch", async () => {
		tempDir = TempDir.createSync("@pi-disabled-direct-commands-");
		await Settings.init({ inMemory: true, cwd: tempDir.path() });
		const sessionManager = SessionManager.inMemory(tempDir.path());
		const session = {
			sessionManager,
			settings,
			agent: {
				state: { tools: [] },
				metadataForProvider: () => undefined,
			},
			customCommands: [],
			skills: [],
			autoCompactionEnabled: true,
			messages: [],
			systemPrompt: [],
			state: { model: undefined },
			model: undefined,
			thinkingLevel: undefined,
			isStreaming: false,
			isCompacting: false,
			newSession: vi.fn(async () => false),
			runEphemeralTurn: vi.fn(),
			refreshSshTool: vi.fn(),
			sendCustomMessage: vi.fn(),
			asyncJobManager: { register: vi.fn() },
		} as unknown as AgentSession;
		mode = new InteractiveMode(session, "test");

		mode.showPinnedError("sentinel");
		const getSessionFile = vi.spyOn(sessionManager, "getSessionFile").mockReturnValue("/tmp/session.jsonl");
		const moveTo = vi.spyOn(sessionManager, "moveTo").mockResolvedValue(undefined);
		const showError = vi.spyOn(mode, "showError").mockImplementation(() => {});
		const showWarning = vi.spyOn(mode, "showWarning").mockImplementation(() => {});
		const showStatus = vi.spyOn(mode, "showStatus").mockImplementation(() => {});
		const showHookCustom = vi.spyOn(mode, "showHookCustom").mockResolvedValue(undefined);
		const requestRender = vi.spyOn(mode.ui, "requestRender");
		requestRender.mockClear();

		await mode.handleDropCommand();
		await mode.handleMoveCommand("/tmp");
		await mode.handleSSHCommand("/ssh help");
		await mode.handleTanCommand("start a background job");
		await mode.handleOmfgCommand("write a rule");

		expect(getSessionFile).not.toHaveBeenCalled();
		expect(moveTo).not.toHaveBeenCalled();
		expect(session.newSession).not.toHaveBeenCalled();
		expect(session.runEphemeralTurn).not.toHaveBeenCalled();
		expect(session.sendCustomMessage).not.toHaveBeenCalled();
		expect(session.asyncJobManager?.register).not.toHaveBeenCalled();
		expect(showError).not.toHaveBeenCalled();
		expect(showWarning).not.toHaveBeenCalled();
		expect(showStatus).not.toHaveBeenCalled();
		expect(showHookCustom).not.toHaveBeenCalled();
		expect(requestRender).not.toHaveBeenCalled();
		expect(mode.errorBannerContainer.children).toHaveLength(1);
	});
});
