import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type SettingPath, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { HindsightSessionState } from "@oh-my-pi/pi-coding-agent/hindsight/state";
import type { MnemopiSessionState } from "@oh-my-pi/pi-coding-agent/mnemopi/state";
import { BUILTIN_TOOLS, createTools, LearnTool, type ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import {
	BUILTIN_TOOL_NAMES,
	PI_DISABLED_TOOL_NAMES,
	PI_PROTECTED_BUILTIN_TOOL_NAMES,
} from "@oh-my-pi/pi-coding-agent/tools/builtin-names";
import { removeWithRetries } from "@oh-my-pi/pi-utils";
import { getAgentDir, setAgentDir } from "@oh-my-pi/pi-utils/dirs";
import { type } from "arktype";
import { getManagedSkillsDir } from "../src/autolearn/managed-skills";
import { ManageSkillTool } from "../src/tools/manage-skill";

function makeSession(
	settingsOverrides: Partial<Record<SettingPath, unknown>> = {},
	extra: Partial<ToolSession> = {},
): ToolSession {
	return {
		cwd: "/tmp/test",
		hasUI: false,
		skipPythonPreflight: true,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(settingsOverrides),
		...extra,
	};
}

describe("Pi learn tool boundary", () => {
	it("publishes memory learn while keeping manage_skill disabled", () => {
		expect(BUILTIN_TOOL_NAMES).toContain("learn");
		expect(BUILTIN_TOOL_NAMES).not.toContain("manage_skill" as never);
		expect(BUILTIN_TOOLS).toHaveProperty("learn");
		expect(BUILTIN_TOOLS).not.toHaveProperty("manage_skill");
		expect(PI_DISABLED_TOOL_NAMES).not.toContain("learn");
		expect(PI_DISABLED_TOOL_NAMES).toContain("manage_skill");
		expect(PI_PROTECTED_BUILTIN_TOOL_NAMES).toContain("learn");
	});

	it("retains learn beside retain, recall, and reflect for episodic backends", async () => {
		for (const backend of ["hindsight", "mnemopi"] as const) {
			const tools = await createTools(makeSession({ "autolearn.enabled": true, "memory.backend": backend }), [
				"read",
			]);
			const names = tools.map(tool => tool.name);
			expect(names).toEqual(expect.arrayContaining(["read", "retain", "recall", "reflect", "learn"]));
			expect(names).not.toContain("manage_skill");
			expect(tools.find(tool => tool.name === "learn")?.loadMode).toBe("essential");
		}
	});

	it("exposes memory learn for local storage independently of autolearn", async () => {
		const names = (await createTools(makeSession({ "memory.backend": "local" }))).map(tool => tool.name);
		expect(names).toContain("learn");
		expect(names).not.toContain("manage_skill");
		const restrictedNames = (await createTools(makeSession({ "memory.backend": "local" }), ["read"])).map(
			tool => tool.name,
		);
		expect(restrictedNames).toEqual(expect.arrayContaining(["read", "learn"]));
	});

	it("omits learn when memory is off", async () => {
		const names = (
			await createTools(makeSession({ "autolearn.enabled": true, "memory.backend": "off" }), [
				"learn",
				"manage_skill",
			])
		).map(tool => tool.name);
		expect(names).not.toContain("learn");
		expect(names).not.toContain("manage_skill");
	});
});

describe("managed-skill direct invocation", () => {
	let tempHome: string;
	let originalAgentDir: string;

	beforeEach(async () => {
		originalAgentDir = getAgentDir();
		tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "pi-managed-skill-disabled-"));
		spyOn(os, "homedir").mockReturnValue(tempHome);
		setAgentDir(path.join(tempHome, ".pi", "agent"));
	});

	afterEach(async () => {
		spyOn(os, "homedir").mockRestore();
		setAgentDir(originalAgentDir);
		await removeWithRetries(tempHome);
	});

	it("cannot be enabled or invoked through the dormant ManageSkillTool", async () => {
		expect(ManageSkillTool.createIf(makeSession({ "autolearn.enabled": true }))).toBeNull();
		await expect(
			new ManageSkillTool().execute("direct", {
				action: "create",
				name: "should-not-exist",
				description: "Never written.",
				body: "# Never",
			}),
		).rejects.toThrow("unavailable in Pi");
		expect(await fs.readdir(getManagedSkillsDir()).catch(() => [])).toEqual([]);
	});
});

describe("memory-only learn execution", () => {
	let tempHome: string;
	let remembered: string[];
	let originalAgentDir: string;

	function mnemopiSession(): ToolSession {
		const fakeState = {
			sessionId: "sess-1",
			session: { sessionManager: { getCwd: () => "/tmp/work" } },
			rememberScoped: (memory: string) => {
				remembered.push(memory);
				return "mem-id";
			},
		};
		return makeSession(
			{ "memory.backend": "mnemopi" },
			{ getMnemopiSessionState: () => fakeState as unknown as MnemopiSessionState },
		);
	}

	beforeEach(async () => {
		originalAgentDir = getAgentDir();
		tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "pi-learn-memory-"));
		spyOn(os, "homedir").mockReturnValue(tempHome);
		setAgentDir(path.join(tempHome, ".pi", "agent"));
		remembered = [];
	});

	afterEach(async () => {
		spyOn(os, "homedir").mockRestore();
		setAgentDir(originalAgentDir);
		await removeWithRetries(tempHome);
	});

	it("stores a scoped Mnemopi lesson without touching managed skills", async () => {
		const result = await new LearnTool(mnemopiSession()).execute("learn-1", {
			memory: "Prefer Bun.file over readFileSync.",
			context: "project convention",
		});
		expect(remembered).toEqual(["Prefer Bun.file over readFileSync."]);
		expect(result.content[0]).toEqual({ type: "text", text: "Lesson stored." });
		expect(await fs.readdir(getManagedSkillsDir()).catch(() => [])).toEqual([]);
	});

	it("rejects a legacy skill payload before memory or filesystem effects", async () => {
		const tool = new LearnTool(mnemopiSession());
		expect(
			tool.parameters({
				memory: "Do not store this partial outcome.",
				skill: { action: "create", name: "blocked", description: "Blocked.", body: "# Blocked" },
			}) instanceof type.errors,
		).toBe(true);
		await expect(
			tool.execute("legacy", {
				memory: "Do not store this partial outcome.",
				skill: { action: "create", name: "blocked", description: "Blocked.", body: "# Blocked" },
			} as never),
		).rejects.toThrow("Managed skill learning is unavailable in Pi");
		expect(remembered).toEqual([]);
		expect(await fs.readdir(getManagedSkillsDir()).catch(() => [])).toEqual([]);
	});

	it("queues a Hindsight lesson with context", async () => {
		const queued: Array<{ memory: string; context?: string }> = [];
		const session = makeSession(
			{ "memory.backend": "hindsight" },
			{
				getHindsightSessionState: () =>
					({
						enqueueRetain: (memory: string, context?: string) => queued.push({ memory, context }),
					}) as unknown as HindsightSessionState,
			},
		);

		const result = await new LearnTool(session).execute("learn-hindsight", {
			memory: "Queue this lesson.",
			context: "from review",
		});
		expect(queued).toEqual([{ memory: "Queue this lesson.", context: "from review" }]);
		expect(result.content[0]).toEqual({ type: "text", text: "Lesson queued for retention." });
	});
});
