/** Pi keeps resume project-local even if a legacy/custom resolver injects a global match. */
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Args } from "@oh-my-pi/pi-coding-agent/cli/args";
import type { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createSessionManager } from "@oh-my-pi/pi-coding-agent/main";
import type { SessionInfo } from "@oh-my-pi/pi-coding-agent/session/session-listing";
import * as sessionListingModule from "@oh-my-pi/pi-coding-agent/session/session-listing";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";

function buildArgs(resume: string, sessionDir?: string): Args {
	return {
		resume,
		sessionDir,
		messages: [],
		fileArgs: [],
		unknownFlags: new Map(),
		unrecognizedFlags: [],
	};
}

function buildGlobalMatch(cwd: string): { session: SessionInfo; scope: "global" } {
	return {
		scope: "global",
		session: {
			path: `${cwd}/019e84ed-b4cc-7000-9c87-5afe6df992c1.jsonl`,
			id: "019e84ed-b4cc-7000-9c87-5afe6df992c1",
			cwd,
			title: "in-other-project",
			created: new Date(0),
			modified: new Date(0),
			messageCount: 0,
			size: 0,
			firstMessage: "",
			allMessagesText: "",
		},
	};
}

const stubSettings = { get: () => undefined } as unknown as Settings;

describe("createSessionManager — Pi cross-project resume boundary", () => {
	// An existing directory so the match is treated as a genuinely different
	// project (fork path), not a moved/renamed worktree (move path).
	let existingProject: string;

	beforeEach(async () => {
		existingProject = await fsp.mkdtemp(path.join(os.tmpdir(), "omp-xproj-"));
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await fsp.rm(existingProject, { recursive: true, force: true });
	});

	it("rejects a resolver-injected global match without prompting", async () => {
		vi.spyOn(sessionListingModule, "resolveResumableSession").mockResolvedValue(buildGlobalMatch(existingProject));
		const forkPrompt = vi.fn(async () => "accepted" as const);
		const movePrompt = vi.fn(async () => "accepted" as const);

		await expect(
			createSessionManager(buildArgs("019e84ed"), "/current/project", stubSettings, forkPrompt, movePrompt),
		).rejects.toThrow('Session "019e84ed" not found in the current project.');

		expect(forkPrompt).not.toHaveBeenCalled();
		expect(movePrompt).not.toHaveBeenCalled();
	});

	it("does not depend on interactive TTY state", async () => {
		const originalIsTTY = process.stdin.isTTY;
		Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
		try {
			vi.spyOn(sessionListingModule, "resolveResumableSession").mockResolvedValue(buildGlobalMatch(existingProject));

			await expect(createSessionManager(buildArgs("019e84ed"), "/current/project", stubSettings)).rejects.toThrow(
				'Session "019e84ed" not found in the current project.',
			);
		} finally {
			Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
		}
	});
});

describe("createSessionManager — moved-session boundary", () => {
	let missingRoot: string;
	let missingProject: string;

	beforeEach(async () => {
		missingRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "omp-moved-xproj-"));
		missingProject = path.join(missingRoot, "worktree-gone");
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await fsp.rm(missingRoot, { recursive: true, force: true });
	});

	it("does not offer move or fork for a missing foreign cwd", async () => {
		vi.spyOn(sessionListingModule, "resolveResumableSession").mockResolvedValue(buildGlobalMatch(missingProject));
		expect(fs.existsSync(missingProject)).toBe(false);

		const forkPrompt = vi.fn(async () => "accepted" as const);
		const movePrompt = vi.fn(async () => "accepted" as const);
		await expect(
			createSessionManager(buildArgs("019e84ed"), "/current/project", stubSettings, forkPrompt, movePrompt),
		).rejects.toThrow('Session "019e84ed" not found in the current project.');
		expect(forkPrompt).not.toHaveBeenCalled();
		expect(movePrompt).not.toHaveBeenCalled();
	});

	it("rejects the same missing foreign cwd in non-interactive mode", async () => {
		const originalIsTTY = process.stdin.isTTY;
		Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
		try {
			vi.spyOn(sessionListingModule, "resolveResumableSession").mockResolvedValue(buildGlobalMatch(missingProject));

			await expect(createSessionManager(buildArgs("019e84ed"), "/current/project", stubSettings)).rejects.toThrow(
				'Session "019e84ed" not found in the current project.',
			);
		} finally {
			Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
		}
	});

	it("rejects a local explicit-session-dir match whose recorded cwd is gone", async () => {
		const currentProject = path.join(missingRoot, "current-project");
		const explicitSessionDir = path.join(missingRoot, "sessions");
		await fsp.mkdir(currentProject, { recursive: true });

		const moved = SessionManager.create(missingProject, explicitSessionDir);
		moved.appendMessage({ role: "user", content: "before local move", timestamp: 1 });
		await moved.flush();
		const oldFile = moved.getSessionFile();
		if (!oldFile) throw new Error("Expected persisted session file");
		const resumePrefix = moved.getSessionId().slice(0, 8);
		const sessionInfo: SessionInfo = {
			path: oldFile,
			id: moved.getSessionId(),
			cwd: missingProject,
			title: "moved-local",
			created: new Date(0),
			modified: new Date(0),
			messageCount: 1,
			size: 0,
			firstMessage: "before local move",
			allMessagesText: "before local move",
		};
		await moved.close();
		expect(fs.existsSync(missingProject)).toBe(false);
		vi.spyOn(sessionListingModule, "resolveResumableSession").mockResolvedValue({
			scope: "local",
			session: sessionInfo,
		});

		const forkPrompt = vi.fn(async () => "accepted" as const);
		const movePrompt = vi.fn(async () => "accepted" as const);
		await expect(
			createSessionManager(
				buildArgs(resumePrefix, explicitSessionDir),
				currentProject,
				stubSettings,
				forkPrompt,
				movePrompt,
			),
		).rejects.toThrow(`Session "${resumePrefix}" not found in the current project.`);
		expect(oldFile).toBeString();
		expect(forkPrompt).not.toHaveBeenCalled();
		expect(movePrompt).not.toHaveBeenCalled();
	});
});
