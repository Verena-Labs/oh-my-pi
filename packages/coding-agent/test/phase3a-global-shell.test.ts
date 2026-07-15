import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { getConfigDirs } from "@oh-my-pi/pi-coding-agent/config";
import { getPathsForTab, hasUi, SETTINGS_SCHEMA } from "@oh-my-pi/pi-coding-agent/config/settings-schema";
import { getAllProvidersInfo } from "@oh-my-pi/pi-coding-agent/discovery";
import { BUILTIN_SLASH_COMMAND_DEFS } from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";

describe("Phase 3A global shell", () => {
	test("registers Pi-owned discovery and compatible extensions without foreign harness providers", () => {
		const providers = getAllProvidersInfo();
		const ids = providers.map(provider => provider.id);
		for (const retained of ["native", "omp-plugins", "claude-plugins", "agents-md", "mcp-json"]) {
			expect(ids).toContain(retained);
		}
		for (const foreign of [
			"claude",
			"cline",
			"agents",
			"codex",
			"cursor",
			"gemini",
			"opencode",
			"github",
			"vscode",
			"windsurf",
		]) {
			expect(ids).not.toContain(foreign);
		}
		expect(providers.find(provider => provider.id === "native")?.displayName).toBe("Pi");
		expect(providers.find(provider => provider.id === "omp-plugins")?.displayName).toBe("Pi Extension Packages");
	});

	test("resolves automatic project configuration only from .pi", () => {
		const cwd = path.join(path.sep, "tmp", "phase3a-project");
		const dirs = getConfigDirs("skills", { cwd, user: false });
		expect(dirs).toEqual([{ path: path.join(cwd, ".pi", "skills"), source: ".pi", level: "project" }]);
	});

	test("does not advertise disabled slash commands or settings", () => {
		const commands = BUILTIN_SLASH_COMMAND_DEFS.map(command => command.name);
		for (const disabled of ["share", "collab", "join", "leave"]) {
			expect(commands).not.toContain(disabled);
		}
		for (const retained of ["export", "plugins", "marketplace", "settings", "usage"]) {
			expect(commands).toContain(retained);
		}

		expect(Reflect.has(SETTINGS_SCHEMA, "startup.checkUpdate")).toBe(false);
		for (const hidden of [
			"collab.relayUrl",
			"collab.webUrl",
			"collab.displayName",
			"share.serverUrl",
			"share.store",
			"share.redactSecrets",
		] as const) {
			expect(hasUi(hidden)).toBe(false);
		}
		const visiblePaths = getPathsForTab("interaction");
		expect(visiblePaths.some(setting => setting.startsWith("collab.") || setting.startsWith("share."))).toBe(false);
	});
});
