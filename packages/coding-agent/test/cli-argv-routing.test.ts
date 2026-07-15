/**
 * Leading global option flags must not hide a subcommand from the CLI runner.
 *
 * The resolver skips leading global flags using the launch parser's
 * value-consumption contract. That both hoists enabled subcommands and rejects
 * disabled historical command words before they can leak into a model prompt.
 */
import { describe, expect, test } from "bun:test";
import { commands, resolveCliArgv } from "@oh-my-pi/pi-coding-agent/cli-commands";

describe("resolveCliArgv routes subcommands hidden behind leading global flags", () => {
	test("advertises retained extension and diagnostic commands but not disabled services", () => {
		const names = commands.map(command => command.name);
		expect(names).toContain("plugin");
		expect(names).toContain("install");
		expect(names).toContain("completions");
		expect(names).toContain("stats");
		expect(names).not.toContain("acp");
		expect(names).not.toContain("join");
		expect(names).not.toContain("update");
	});
	test("rejects ACP behind an equals-form global flag", () => {
		expect(resolveCliArgv(["--approval-mode=yolo", "acp"])).toEqual({
			error: "ACP is not available in Pi.",
		});
	});

	test("rejects ACP behind a space-form global flag", () => {
		expect(resolveCliArgv(["--approval-mode", "yolo", "acp"])).toEqual({
			error: "ACP is not available in Pi.",
		});
	});

	test("rejects ACP behind multiple value-consuming flags", () => {
		expect(resolveCliArgv(["--approval-mode=yolo", "--model", "gpt", "acp"])).toEqual({
			error: "ACP is not available in Pi.",
		});
	});

	test("a value-consuming flag does not mistake its value for a subcommand", () => {
		// `acp` here is the value of `--model`, not the subcommand, so this stays a
		// launch prompt exactly as the launch parser would read it.
		expect(resolveCliArgv(["--model", "acp"])).toEqual({
			argv: ["launch", "--model", "acp"],
		});
	});

	test("`--` ends option scanning so a following subcommand stays a launch prompt", () => {
		expect(resolveCliArgv(["--", "acp"])).toEqual({
			argv: ["launch", "--", "acp"],
		});
	});

	test("a genuine launch prompt is untouched", () => {
		expect(resolveCliArgv(["--approval-mode=yolo", "fix", "the", "bug"])).toEqual({
			argv: ["launch", "--approval-mode=yolo", "fix", "the", "bug"],
		});
	});

	test("a disabled command already in front is rejected", () => {
		expect(resolveCliArgv(["acp", "--approval-mode=yolo"])).toEqual({
			error: "ACP is not available in Pi.",
		});
	});

	test("rejects collaboration and executable update routes", () => {
		expect(resolveCliArgv(["join", "pi-collab://example"])).toEqual({
			error: "Live collaboration is not available in Pi.",
		});
		expect(resolveCliArgv(["update"])).toEqual({
			error: "Pi executable updates are owned by the consuming distribution.",
		});
	});

	test("`gc` dispatches as a top-level maintenance subcommand", () => {
		expect(resolveCliArgv(["gc", "--apply"])).toEqual({
			argv: ["gc", "--apply"],
		});
	});
});
