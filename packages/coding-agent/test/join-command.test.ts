/** Disabled collaboration words must fail before they can become a model prompt. */
import { describe, expect, test } from "bun:test";
import { isSubcommand, resolveCliArgv } from "@oh-my-pi/pi-coding-agent/cli-commands";

describe("join command is disabled", () => {
	test("CLI runner rejects `join <link>` instead of forwarding it to launch", () => {
		expect(isSubcommand("join")).toBe(false);
		expect(resolveCliArgv(["join", "pi-collab://example"])).toEqual({
			error: "Live collaboration is not available in Pi.",
		});
	});
});
