import { afterEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "../src/config/settings";
import { getUi } from "../src/config/settings-schema";
import { loadCustomCommands } from "../src/extensibility/custom-commands/loader";
import { TaskTool } from "../src/task";
import * as discoveryModule from "../src/task/discovery";
import * as executorModule from "../src/task/executor";
import * as isolationRunner from "../src/task/isolation-runner";
import type { AgentDefinition, SingleResult } from "../src/task/types";
import type { ToolSession } from "../src/tools";

const taskAgent = {
	name: "task",
	description: "General-purpose task agent",
	systemPrompt: "Complete the assigned task.",
	source: "bundled",
} satisfies AgentDefinition;

const artifactDirs: string[] = [];

function result(id: string, overrides: Partial<SingleResult> = {}): SingleResult {
	return {
		index: 0,
		id,
		agent: "task",
		agentSource: "bundled",
		task: "Complete the assigned task.",
		assignment: "Complete the assigned task.",
		exitCode: 0,
		output: "Done.",
		stderr: "",
		truncated: false,
		durationMs: 1,
		tokens: 0,
		requests: 1,
		...overrides,
	};
}

function createSession(mergeMode: "patch" | "branch" = "patch"): ToolSession {
	return {
		cwd: os.tmpdir(),
		hasUI: false,
		settings: Settings.isolated({
			"async.enabled": false,
			"task.batch": false,
			"task.isolation.mode": "auto",
			"task.isolation.merge": mergeMode,
		}),
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
	} as unknown as ToolSession;
}

function mockAgentDiscovery(): void {
	vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
		agents: [taskAgent],
		projectAgentsDir: null,
	});
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(artifactDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe("Pi Phase 3D workflow boundaries", () => {
	it("describes isolation as explicit capture for manual integration", () => {
		const modeDescription = getUi("task.isolation.mode")?.description ?? "";
		const captureDescription = getUi("task.isolation.merge")?.description ?? "";

		expect(modeDescription).toContain("explicit task calls");
		expect(modeDescription).toContain("never isolated automatically");
		expect(captureDescription).toContain("retained");
		expect(captureDescription).toContain("manual integration");
	});

	it("does not bundle the dedicated CI-green loop", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-custom-commands-"));
		artifactDirs.push(root);

		const loaded = await loadCustomCommands({ cwd: root, agentDir: root });
		const names = loaded.commands.map(command => command.command.name);

		expect(loaded.errors).toEqual([]);
		expect(names).toContain("review");
		expect(names).not.toContain("green");
	});

	it("keeps configured isolation opt-in when the call omits isolated", async () => {
		mockAgentDiscovery();
		const prepareSpy = vi.spyOn(isolationRunner, "prepareIsolationContext");
		const isolatedRunSpy = vi.spyOn(isolationRunner, "runIsolatedSubprocess");
		const runSpy = vi.spyOn(executorModule, "runSubprocess").mockResolvedValue(result("Direct"));
		const tool = await TaskTool.create(createSession());

		const output = await tool.execute("task-call", { agent: "task", task: "Work normally." });

		expect(runSpy).toHaveBeenCalledTimes(1);
		expect(prepareSpy).not.toHaveBeenCalled();
		expect(isolatedRunSpy).not.toHaveBeenCalled();
		expect(output.content[0]?.type === "text" ? output.content[0].text : "").not.toContain("Manual isolation");
	});

	it("returns manual patch and branch artifacts without applying either mode", async () => {
		mockAgentDiscovery();
		vi.spyOn(isolationRunner, "prepareIsolationContext").mockResolvedValue({
			repoRoot: "/tmp/repo",
			baseline: {
				root: {
					repoRoot: "/tmp/repo",
					headCommit: "base",
					staged: "",
					unstaged: "",
					untracked: [],
					untrackedPatch: "",
				},
				nested: [],
			},
		});
		const mergeSpy = vi.spyOn(isolationRunner, "mergeIsolatedChanges");
		const nestedApplySpy = vi.spyOn(isolationRunner, "applyEligibleNestedPatches");
		vi.spyOn(isolationRunner, "runIsolatedSubprocess").mockImplementation(async options => {
			if (options.mergeMode === "branch") {
				return result(options.agentId, { branchName: `pi/task/${options.agentId}` });
			}
			artifactDirs.push(options.artifactsDir);
			const patchPath = path.join(options.artifactsDir, `${options.agentId}.patch`);
			await Bun.write(patchPath, "captured patch\n");
			return result(options.agentId, { patchPath });
		});

		const patchTool = await TaskTool.create(createSession("patch"));
		const patchOutput = await patchTool.execute("patch-call", {
			agent: "task",
			task: "Work in isolation.",
			isolated: true,
		});
		const patchText = patchOutput.content[0]?.type === "text" ? patchOutput.content[0].text : "";
		const patchPath = patchOutput.details?.results[0]?.patchPath;
		expect(patchText).toContain("Not applied; integrate manually");
		expect(patchPath).toBeDefined();
		expect(await Bun.file(patchPath!).text()).toBe("captured patch\n");

		const branchTool = await TaskTool.create(createSession("branch"));
		const branchOutput = await branchTool.execute("branch-call", {
			agent: "task",
			task: "Work in isolation.",
			isolated: true,
		});
		const branchText = branchOutput.content[0]?.type === "text" ? branchOutput.content[0].text : "";
		expect(branchText).toContain("Not merged; integrate manually");
		expect(branchOutput.details?.results[0]?.branchName).toMatch(/^pi\/task\//);
		expect(mergeSpy).not.toHaveBeenCalled();
		expect(nestedApplySpy).not.toHaveBeenCalled();
	});
});
