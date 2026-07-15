import { describe, expect, test } from "bun:test";
import { buildAvailableSlashCommands } from "@oh-my-pi/pi-coding-agent/slash-commands/available-commands";

describe("buildAvailableSlashCommands", () => {
	test("returns RPC-safe command metadata with stable sources", async () => {
		const fileCommands = [{ name: "notes", description: "Open notes", content: "body", source: "test" }];
		const mcpPrompt = {
			path: "mcp:server/prompt",
			resolvedPath: "mcp:server/prompt",
			source: "project",
			command: { name: "server:prompt", description: "MCP prompt" },
		};
		const session = {
			extensionRunner: {
				getRegisteredCommands: () => [{ name: "ext:hello", description: "Extension hello" }],
			},
			customCommands: [
				mcpPrompt,
				{
					path: "custom.ts",
					resolvedPath: "custom.ts",
					source: "project",
					command: { name: "custom:hello", description: "Custom hello" },
				},
			],
			mcpPromptCommands: [mcpPrompt],
			skills: [{ name: "reviewer", description: "Review code", filePath: "/tmp/reviewer/SKILL.md" }],
			skillsSettings: { enableSkillCommands: true },
			sessionManager: { getCwd: () => process.cwd() },
			setSlashCommands(commands: typeof fileCommands) {
				expect(commands).toEqual(fileCommands);
			},
		};

		const commands = await buildAvailableSlashCommands(session as never, async () => fileCommands);
		const byName = Object.fromEntries(commands.map(command => [command.name, command]));

		expect(byName.usage.subcommands).toContainEqual({
			name: "show",
			description: "Show provider usage and limits",
		});
		expect(byName.usage.subcommands).toContainEqual({
			name: "reset",
			description: "Spend a saved Codex rate-limit reset",
			usage: "[account|active]",
		});
		expect(byName["reset-usage"]).toBeUndefined();
		for (const disabled of ["share", "collab", "join", "leave"]) {
			expect(byName[disabled]).toBeUndefined();
		}
		for (const retained of ["export", "plugins", "marketplace", "usage"]) {
			expect(byName[retained]).toBeDefined();
		}

		expect(byName.fast.description).toBe("Toggle fast mode");
		expect(byName["ext:hello"].description).toBe("Extension hello");
		expect(byName["custom:hello"].description).toBe("Custom hello");
		expect(byName["server:prompt"].description).toBe("MCP prompt");
		expect(byName.notes.description).toBe("Open notes");
		expect(byName["skill:reviewer"].description).toBe("Review code");

		expect(byName.model.source).toBe("builtin");
		expect(byName["skill:reviewer"].source).toBe("skill");
		expect(byName["ext:hello"].source).toBe("extension");
		expect(byName["server:prompt"].source).toBe("mcp_prompt");
		expect(byName["custom:hello"].source).toBe("custom");
		expect(byName.notes.source).toBe("file");
	});

	test("loads file commands into the session before advertising them", async () => {
		const fileCommands = [{ name: "notes", description: "Open notes", content: "body", source: "test" }];
		let loadedCommands: typeof fileCommands | undefined;

		const commands = await buildAvailableSlashCommands(
			{
				customCommands: [],
				skills: [],
				sessionManager: { getCwd: () => process.cwd() },
				setSlashCommands(commands: typeof fileCommands) {
					loadedCommands = commands;
				},
			} as never,
			async () => fileCommands,
		);

		expect(loadedCommands).toEqual(fileCommands);
		expect(commands.find(command => command.name === "notes")?.source).toBe("file");
	});

	test("classifies MCP prompts by path and retained bundled custom commands as custom", async () => {
		const commands = await buildAvailableSlashCommands(
			{
				customCommands: [
					{
						path: "mcp:server/prompt",
						resolvedPath: "mcp:server/prompt",
						source: "project",
						command: { name: "server:prompt", description: "MCP prompt" },
					},
					{
						path: "bundled-example.md",
						resolvedPath: "bundled-example.md",
						source: "bundled",
						command: { name: "bundled-example", description: "Bundled custom command" },
					},
				],
				skills: [],
				sessionManager: { getCwd: () => process.cwd() },
				setSlashCommands() {},
			} as never,
			async () => [],
		);

		const byName = Object.fromEntries(commands.map(command => [command.name, command]));
		expect(byName["server:prompt"].source).toBe("mcp_prompt");
		expect(byName["bundled-example"].source).toBe("custom");
	});

	test("keeps legacy custom command fixtures without a path classified as custom", async () => {
		const commands = await buildAvailableSlashCommands(
			{
				customCommands: [{ command: { name: "legacy", description: "Legacy fixture" } }],
				skills: [],
				sessionManager: { getCwd: () => process.cwd() },
				setSlashCommands() {},
			} as never,
			async () => [],
		);

		expect(commands.find(command => command.name === "legacy")?.source).toBe("custom");
	});

	test("filters Pi-disabled names across extension, custom, MCP prompt, and file sources", async () => {
		let adoptedFileCommands: Array<{ name: string }> = [];
		const commands = await buildAvailableSlashCommands(
			{
				extensionRunner: {
					getRegisteredCommands: () => [
						{ name: "retry", description: "disabled extension" },
						{ name: "ssh:connect", description: "disabled namespaced extension" },
						{ name: "autoresearch", description: "disabled autoresearch extension" },
						{ name: "ext:allowed", description: "allowed extension" },
					],
				},
				customCommands: [
					{ command: { name: "shake", description: "disabled custom" } },
					{ command: { name: "green", description: "disabled CI-green custom command" } },
					{ path: "mcp:ssh/prompt", command: { name: "ssh:prompt", description: "disabled MCP prompt" } },
					{
						path: "mcp:green/loop",
						command: { name: "green:loop", description: "disabled namespaced MCP prompt" },
					},
					{ command: { name: "custom:allowed", description: "allowed custom" } },
				],
				skills: [],
				sessionManager: { getCwd: () => process.cwd() },
				setSlashCommands(fileCommands: Array<{ name: string }>) {
					adoptedFileCommands = fileCommands;
				},
			} as never,
			async () => [
				{ name: "move", description: "disabled file", content: "disabled", source: "test" },
				{ name: "autoresearch:run", description: "disabled file", content: "disabled", source: "test" },
				{ name: "file:allowed", description: "allowed file", content: "allowed", source: "test" },
			],
		);

		expect(commands.map(command => command.name)).toContain("ext:allowed");
		expect(commands.map(command => command.name)).toContain("custom:allowed");
		expect(commands.map(command => command.name)).toContain("file:allowed");
		for (const disabled of [
			"retry",
			"ssh:connect",
			"autoresearch",
			"shake",
			"green",
			"ssh:prompt",
			"green:loop",
			"move",
			"autoresearch:run",
		]) {
			expect(commands.map(command => command.name)).not.toContain(disabled);
		}
		expect(adoptedFileCommands.map(command => command.name)).toEqual(["file:allowed"]);
	});
});
