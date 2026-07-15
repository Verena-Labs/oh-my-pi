import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createSessionTeardown } from "@oh-my-pi/pi-coding-agent/modes/session-teardown";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { convertToLlm } from "@oh-my-pi/pi-coding-agent/session/messages";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { postmortem, TempDir } from "@oh-my-pi/pi-utils";
import {
	collectPendingToolCalls,
	describePendingToolCalls,
	SESSION_EXIT_CUSTOM_TYPE,
	TOOL_EXECUTION_START_CUSTOM_TYPE,
	type ToolExecutionStartData,
} from "../src/session/exit-diagnostics";

const pendingAssistant: AssistantMessage = {
	role: "assistant",
	content: [
		{
			type: "toolCall",
			id: "toolu_repro",
			name: "bash",
			arguments: { command: "bun run check:ts" },
		},
	],
	api: "anthropic-messages",
	provider: "anthropic",
	model: "mock",
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "toolUse",
	timestamp: Date.now(),
};

describe.skip("OMP session exit diagnostics (disabled in Pi)", () => {
	let session: AgentSession | undefined;
	let authStorage: AuthStorage | undefined;
	let tempDir: TempDir | undefined;

	afterEach(async () => {
		await session?.dispose();
		session = undefined;
		authStorage?.close();
		authStorage = undefined;
		tempDir?.removeSync();
		tempDir = undefined;
	});

	it("records a durable tool start marker and shutdown diagnostic before a pending result exists", async () => {
		tempDir = TempDir.createSync("@pi-session-exit-");
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "auth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		const modelRegistry = new ModelRegistry(authStorage);
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected built-in anthropic model to exist");
		const sessionManager = SessionManager.inMemory(tempDir.path());
		const agent = new Agent({
			initialState: {
				model,
				systemPrompt: ["Test"],
				tools: [],
				messages: [],
			},
			convertToLlm,
		});
		session = new AgentSession({
			agent,
			sessionManager,
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry,
		});

		agent.emitExternalEvent({ type: "message_end", message: pendingAssistant });
		await Promise.resolve();
		agent.emitExternalEvent({
			type: "tool_execution_start",
			toolCallId: "toolu_repro",
			toolName: "bash",
			args: { command: "bun run check:ts" },
		});
		await Promise.resolve();

		const marker = sessionManager
			.getEntries()
			.find(entry => entry.type === "custom" && entry.customType === TOOL_EXECUTION_START_CUSTOM_TYPE);
		if (marker?.type !== "custom") throw new Error("Expected tool execution start marker");
		expect(marker.data).toMatchObject({
			toolCallId: "toolu_repro",
			toolName: "bash",
			args: { command: "bun run check:ts" },
		});

		const pending = collectPendingToolCalls(sessionManager.getBranch());
		expect(pending).toMatchObject([
			{
				toolCallId: "toolu_repro",
				toolName: "bash",
				args: { command: "bun run check:ts" },
			},
		]);
		expect(describePendingToolCalls(sessionManager.getBranch())).toContain("bun run check:ts");

		await session.dispose();
		session = undefined;
		const exitEntry = sessionManager
			.getEntries()
			.find(entry => entry.type === "custom" && entry.customType === SESSION_EXIT_CUSTOM_TYPE);
		if (exitEntry?.type !== "custom") throw new Error("Expected session exit marker");
		expect(exitEntry.data).toMatchObject({
			reason: "dispose",
			kind: "normal",
			pendingToolCalls: [
				{
					toolCallId: "toolu_repro",
					toolName: "bash",
					args: { command: "bun run check:ts" },
				},
			],
		});
	});

	it("signal teardown persists the postmortem reason, not the generic dispose", async () => {
		tempDir = TempDir.createSync("@pi-session-exit-signal-");
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "auth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		const modelRegistry = new ModelRegistry(authStorage);
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected built-in anthropic model to exist");
		const sessionManager = SessionManager.inMemory(tempDir.path());
		const agent = new Agent({
			initialState: {
				model,
				systemPrompt: ["Test"],
				tools: [],
				messages: [],
			},
			convertToLlm,
		});
		session = new AgentSession({
			agent,
			sessionManager,
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry,
		});
		const activeSession = session;

		// The assistant message persists through an async queue; the tool start
		// marker is appended synchronously and is what makes the session durable
		// enough for #recordSessionExit to write the exit entry (same setup as
		// the plain-dispose test above).
		agent.emitExternalEvent({ type: "message_end", message: pendingAssistant });
		await Promise.resolve();
		agent.emitExternalEvent({
			type: "tool_execution_start",
			toolCallId: "toolu_repro",
			toolName: "bash",
			args: { command: "bun run check:ts" },
		});
		await Promise.resolve();

		// Mirror InteractiveMode.init(): the postmortem "session-teardown"
		// callback runs FIRST on SIGTERM/SIGHUP/uncaughtException (reverse
		// registration order) and calls dispose(). Without reason threading,
		// #doDispose would persist the generic "dispose"/"normal" and cancel the
		// reason-specific agent-session recorder — losing the real trigger.
		const teardown = createSessionTeardown({
			getDraftText: () => "",
			beginDispose: () => activeSession.beginDispose(),
			saveDraft: async () => {},
			disposeSession: () => activeSession.dispose(),
		});

		await teardown(postmortem.Reason.SIGTERM);
		session = undefined;

		const exitEntry = sessionManager
			.getEntries()
			.find(entry => entry.type === "custom" && entry.customType === SESSION_EXIT_CUSTOM_TYPE);
		if (exitEntry?.type !== "custom") throw new Error("Expected session exit marker");
		expect(exitEntry.data).toMatchObject({
			reason: "sigterm",
			kind: "signal",
		});
	});

	it("does not materialize an empty session just to write an exit marker", async () => {
		tempDir = TempDir.createSync("@pi-empty-session-exit-");
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "auth.db"));
		const modelRegistry = new ModelRegistry(authStorage);
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected built-in anthropic model to exist");
		const sessionManager = SessionManager.create(tempDir.path(), tempDir.path());
		const sessionFile = sessionManager.getSessionFile();
		if (!sessionFile) throw new Error("Expected persistent session file path");
		const agent = new Agent({
			initialState: {
				model,
				systemPrompt: ["Test"],
				tools: [],
				messages: [],
			},
			convertToLlm,
		});
		session = new AgentSession({
			agent,
			sessionManager,
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry,
		});

		await session.dispose();
		session = undefined;

		expect(fs.existsSync(sessionFile)).toBe(false);
		expect(
			sessionManager
				.getEntries()
				.some(entry => entry.type === "custom" && entry.customType === SESSION_EXIT_CUSTOM_TYPE),
		).toBe(false);
	});

	it("treats assistant tool calls as pending even when stopReason is not toolUse", () => {
		const sessionManager = SessionManager.inMemory();
		sessionManager.appendMessage({ ...pendingAssistant, stopReason: "stop" });

		expect(collectPendingToolCalls(sessionManager.getBranch())).toMatchObject([
			{
				toolCallId: "toolu_repro",
				toolName: "bash",
				args: { command: "bun run check:ts" },
			},
		]);
		expect(describePendingToolCalls(sessionManager.getBranch())).toContain("bun run check:ts");
	});

	it("clears the pending warning once the matching tool result is recorded", () => {
		const sessionManager = SessionManager.inMemory();
		sessionManager.appendMessage(pendingAssistant);
		sessionManager.appendCustomEntry(TOOL_EXECUTION_START_CUSTOM_TYPE, {
			toolCallId: "toolu_repro",
			toolName: "bash",
			args: { command: "bun run check:ts" },
			startedAt: new Date().toISOString(),
		} satisfies ToolExecutionStartData);
		sessionManager.appendMessage({
			role: "toolResult",
			toolCallId: "toolu_repro",
			toolName: "bash",
			content: [{ type: "text", text: "ok" }],
			isError: false,
			timestamp: Date.now(),
		});

		expect(collectPendingToolCalls(sessionManager.getBranch())).toEqual([]);
		expect(describePendingToolCalls(sessionManager.getBranch())).toBeUndefined();
	});
});

describe("Pi ordinary session persistence without stop-recovery diagnostics", () => {
	it("persists assistant messages and tool results without diagnostic custom entries", async () => {
		const tempDir = TempDir.createSync("@pi-session-journal-");
		const authStorage = await AuthStorage.create(path.join(tempDir.path(), "auth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		const modelRegistry = new ModelRegistry(authStorage);
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected built-in anthropic model to exist");
		const sessionManager = SessionManager.create(tempDir.path(), tempDir.path());
		const sessionFile = sessionManager.getSessionFile();
		if (!sessionFile) throw new Error("Expected persistent session file path");
		const agent = new Agent({
			initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] },
			convertToLlm,
		});
		const session = new AgentSession({
			agent,
			sessionManager,
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry,
		});

		try {
			agent.emitExternalEvent({ type: "message_end", message: pendingAssistant });
			agent.emitExternalEvent({
				type: "tool_execution_start",
				toolCallId: "toolu_repro",
				toolName: "bash",
				args: { command: "bun run check:ts" },
			});
			agent.emitExternalEvent({
				type: "message_end",
				message: {
					role: "toolResult",
					toolCallId: "toolu_repro",
					toolName: "bash",
					content: [{ type: "text", text: "ok" }],
					isError: false,
					timestamp: Date.now(),
				},
			});
			await session.dispose();

			const entries = sessionManager.getEntries();
			expect(entries.filter(entry => entry.type === "message").map(entry => entry.message.role)).toEqual([
				"assistant",
				"toolResult",
			]);
			expect(
				entries.some(
					entry =>
						entry.type === "custom" &&
						(entry.customType === TOOL_EXECUTION_START_CUSTOM_TYPE ||
							entry.customType === SESSION_EXIT_CUSTOM_TYPE),
				),
			).toBe(false);

			const jsonl = fs.readFileSync(sessionFile, "utf8");
			expect(jsonl).toContain('"role":"assistant"');
			expect(jsonl).toContain('"role":"toolResult"');
			expect(jsonl).not.toContain('"customType":"tool_execution_start"');
			expect(jsonl).not.toContain('"customType":"session_exit"');
		} finally {
			await session.dispose();
			authStorage.close();
			tempDir.removeSync();
		}
	});

	it("does not initialize pending-call warnings or postmortem session callbacks", async () => {
		const mainSource = await Bun.file(path.join(import.meta.dir, "../src/main.ts")).text();
		const agentSessionSource = await Bun.file(path.join(import.meta.dir, "../src/session/agent-session.ts")).text();
		const interactiveSource = await Bun.file(path.join(import.meta.dir, "../src/modes/interactive-mode.ts")).text();

		expect(mainSource).not.toContain("describePendingToolCalls");
		expect(mainSource).not.toContain("Resumed session has pending tool calls");
		expect(agentSessionSource).not.toContain("TOOL_EXECUTION_START_CUSTOM_TYPE");
		expect(agentSessionSource).not.toContain("SESSION_EXIT_CUSTOM_TYPE");
		expect(agentSessionSource).not.toContain("postmortem.register(`agent-session:");
		expect(interactiveSource).not.toContain('postmortem.register("session-teardown"');
	});

	it("keeps the dormant pending-call classifier inert on direct invocation", () => {
		const sessionManager = SessionManager.inMemory();
		sessionManager.appendMessage(pendingAssistant);

		expect(collectPendingToolCalls(sessionManager.getBranch())).toEqual([]);
		expect(describePendingToolCalls(sessionManager.getBranch())).toBeUndefined();
	});
});
