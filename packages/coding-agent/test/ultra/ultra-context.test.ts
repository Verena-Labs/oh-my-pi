import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import {
	buildUltraForkContext,
	parseUltraForkTurns,
	selectUltraForkMessages,
} from "@oh-my-pi/pi-coding-agent/ultra/context";

function messages(...items: unknown[]): AgentMessage[] {
	return items as AgentMessage[];
}

describe("Ultra parent-context inheritance", () => {
	it("selects the effective conversation through the current user turn", () => {
		const conversation = messages(
			{ role: "compactionSummary", summary: "resolved compacted history" },
			{ role: "user", content: [{ type: "text", text: "earlier request" }] },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "private reasoning" },
					{ type: "text", text: "earlier answer" },
					{ type: "toolCall", id: "u1", name: "ultra_spawn", arguments: { prompt: "hidden" } },
				],
			},
			{
				role: "toolResult",
				toolCallId: "u1",
				toolName: "ultra_spawn",
				content: [{ type: "text", text: "internal worker" }],
			},
			{ role: "user", content: [{ type: "text", text: "current request" }] },
			{
				role: "fileMention",
				files: [{ path: "src/a.ts", content: "export const a = 1;" }],
			},
			{ role: "assistant", content: [{ type: "text", text: "in-progress spawn response" }] },
		);

		const inherited = buildUltraForkContext(
			{ messages: conversation, maxContextTokens: 20_000, contextWindow: 32_000 },
			"all",
			"review the implementation",
		);

		expect(inherited?.text).toContain("resolved compacted history");
		expect(inherited?.text).toContain("earlier answer");
		expect(inherited?.text).toContain("current request");
		expect(inherited?.text).toContain("src/a.ts");
		expect(inherited?.text).not.toContain("private reasoning");
		expect(inherited?.text).not.toContain("internal worker");
		expect(inherited?.text).not.toContain("in-progress spawn response");
	});

	it("limits positive fork_turns to complete recent user-led turns", () => {
		const conversation = messages(
			{ role: "user", content: [{ type: "text", text: "old turn" }] },
			{ role: "assistant", content: [{ type: "text", text: "old answer" }] },
			{ role: "user", content: [{ type: "text", text: "current turn" }] },
			{ role: "custom", customType: "attachment-note", attribution: "user", content: "current companion" },
		);

		const selected = selectUltraForkMessages(conversation, "1");
		const inherited = buildUltraForkContext(
			{ messages: conversation, maxContextTokens: 20_000, contextWindow: 32_000 },
			"1",
			"do the work",
		);

		expect(selected).toHaveLength(2);
		expect(inherited?.text).toContain("current turn");
		expect(inherited?.text).toContain("current companion");
		expect(inherited?.text).not.toContain("old turn");
		expect(inherited?.selectedTurns).toBe(1);
	});

	it("renders provider protocol as inert summaries and images as placeholders", () => {
		const conversation = messages(
			{
				role: "user",
				content: [
					{ type: "text", text: "inspect this" },
					{ type: "image", data: "base64", mimeType: "image/png" },
				],
			},
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "t1", name: "read", arguments: { path: "src/a.ts" } }],
			},
			{ role: "toolResult", toolCallId: "t1", toolName: "read", content: [{ type: "text", text: "file text" }] },
			{ role: "user", content: [{ type: "text", text: "continue" }] },
		);

		const inherited = buildUltraForkContext(
			{ messages: conversation, maxContextTokens: 20_000, contextWindow: 32_000 },
			"all",
			"finish",
		);

		expect(inherited?.text).toContain("assistant_tool_call");
		expect(inherited?.text).toContain("tool_result_summary");
		expect(inherited?.text).toContain("Image attachment omitted");
	});

	it("rejects invalid selectors and contexts that exceed the worker budget", () => {
		for (const invalid of ["0", "-1", "1.5", "recent", ""]) {
			expect(() => parseUltraForkTurns(invalid)).toThrow("positive integer string");
		}
		expect(parseUltraForkTurns(undefined)).toBe("all");
		expect(parseUltraForkTurns("12")).toBe("12");
		expect(() =>
			buildUltraForkContext(
				{
					messages: messages({ role: "user", content: [{ type: "text", text: "x".repeat(8_000) }] }),
					maxContextTokens: 1,
					contextWindow: 4_096,
				},
				"all",
				"assignment",
			),
		).toThrow('smaller positive fork_turns value or "none"');
	});

	it("inherits nothing when fork_turns is none", () => {
		expect(
			buildUltraForkContext(
				{
					messages: messages({ role: "user", content: [{ type: "text", text: "secret" }] }),
					maxContextTokens: 10_000,
					contextWindow: 16_000,
				},
				"none",
				"assignment",
			),
		).toBeUndefined();
	});
});
