import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { type CreateAgentSessionOptions, createAgentSession, discoverAuthStorage } from "@oh-my-pi/pi-coding-agent/sdk";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { ULTRA_THINKING } from "@oh-my-pi/pi-coding-agent/thinking";
import { ULTRA_TOOL_NAMES } from "@oh-my-pi/pi-coding-agent/tools/ultra";
import { removeSyncWithRetries, Snowflake } from "@oh-my-pi/pi-utils";

describe("SDK Ultra tool activation", () => {
	const tempDirs: string[] = [];
	let modelRegistry!: ModelRegistry;
	let registryAuthDir: string;

	const makeTempDir = (): string => {
		const tempDir = path.join(os.tmpdir(), `pi-sdk-ultra-tool-activation-${Snowflake.next()}`);
		tempDirs.push(tempDir);
		fs.mkdirSync(tempDir, { recursive: true });
		return tempDir;
	};

	beforeAll(async () => {
		registryAuthDir = path.join(os.tmpdir(), `pi-sdk-ultra-tool-activation-auth-${Snowflake.next()}`);
		fs.mkdirSync(registryAuthDir, { recursive: true });
		modelRegistry = new ModelRegistry(await discoverAuthStorage(registryAuthDir));
	});

	const baseOptions = (tempDir: string): CreateAgentSessionOptions => ({
		cwd: tempDir,
		agentDir: tempDir,
		modelRegistry,
		sessionManager: SessionManager.inMemory(),
		settings: Settings.isolated(),
		model: getBundledModel("openai", "gpt-5.5"),
		disableExtensionDiscovery: true,
		skills: [],
		contextFiles: [],
		promptTemplates: [],
		slashCommands: [],
		enableMCP: false,
		enableLsp: false,
		rules: [],
		workspaceTree: { rootPath: tempDir, rendered: "", truncated: false, totalLines: 0, agentsMdFiles: [] },
	});

	afterEach(() => {
		for (const tempDir of tempDirs.splice(0)) removeSyncWithRetries(tempDir);
	});

	afterAll(() => {
		removeSyncWithRetries(registryAuthDir);
	});

	it("activates an exclusive Ultra tool surface and restores the prior active toolset", async () => {
		const tempDir = makeTempDir();
		const { session } = await createAgentSession(baseOptions(tempDir));
		const previousActiveToolNames = session.getActiveToolNames();
		expect(previousActiveToolNames).toContain("task");

		try {
			for (const name of ULTRA_TOOL_NAMES) expect(session.getToolByName(name)).toBeUndefined();

			session.setThinkingLevel(ULTRA_THINKING);
			await session.syncUltraPolicy();
			expect(session.getToolByName("task")).toBeUndefined();
			expect(session.getActiveToolNames()).not.toContain("task");
			for (const name of ULTRA_TOOL_NAMES) {
				expect(session.getToolByName(name)).toBeDefined();
				expect(session.getActiveToolNames()).toContain(name);
			}
			expect(session.getActiveToolNames().toSorted()).toEqual(
				[...new Set([...previousActiveToolNames.filter(name => name !== "task"), ...ULTRA_TOOL_NAMES])].toSorted(),
			);

			session.setThinkingLevel(ThinkingLevel.XHigh);
			await session.syncUltraPolicy();
			for (const name of ULTRA_TOOL_NAMES) expect(session.getToolByName(name)).toBeUndefined();
			expect(session.getToolByName("task")).toBeDefined();
			expect(session.getActiveToolNames()).toEqual(previousActiveToolNames);
		} finally {
			await session.dispose();
		}
	});

	it("keeps recursive Ultra workers outside the named-agent task surface", async () => {
		const parentTempDir = makeTempDir();
		const workerTempDir = makeTempDir();
		const { session: parentSession } = await createAgentSession({
			...baseOptions(parentTempDir),
			thinkingLevel: ULTRA_THINKING,
		});
		const { session } = await createAgentSession({
			...baseOptions(workerTempDir),
			thinkingLevel: ULTRA_THINKING,
			ultraWorker: true,
			taskDepth: 1,
			parentTaskPrefix: "ultra-worker",
		});

		try {
			expect(session.getToolByName("task")).toBeUndefined();
			expect(session.getActiveToolNames()).not.toContain("task");
			for (const name of ULTRA_TOOL_NAMES) {
				expect(session.getToolByName(name)).toBeDefined();
				expect(session.getActiveToolNames()).toContain(name);
			}
		} finally {
			await session.dispose();
			await parentSession.dispose();
		}
	});
});
