import { beforeAll, describe, expect, it } from "bun:test";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { SegmentContext } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/segments";
import { renderSegment } from "@oh-my-pi/pi-coding-agent/modes/components/status-line/segments";
import { initTheme, theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { BUILTIN_SLASH_COMMAND_DEFS } from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";
import { type ConfiguredThinkingLevel, ULTRA_THINKING } from "@oh-my-pi/pi-coding-agent/thinking";

beforeAll(async () => {
	await initTheme();
});

function createModelContext(advisorActive: boolean): SegmentContext {
	return {
		session: {
			state: { model: { id: "test-model", name: "Test Model" } },
			isFastModeActive: () => false,
			isAutoThinking: false,
			autoResolvedThinkingLevel: () => undefined,
			isAdvisorActive: () => advisorActive,
		} as unknown as SegmentContext["session"],
		width: 120,
		compactThinkingLevel: false,
		options: {},
		planMode: null,
		loopMode: null,
		prewalk: null,
		goalMode: null,
		collab: null,
		usageStats: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			orchestrationInput: 0,
			orchestrationOutput: 0,
			orchestrationCacheRead: 0,
			premiumRequests: 0,
			cost: 0,
			tokensPerSecond: null,
		},
		contextPercent: 0,
		contextTokens: 0,
		contextWindow: 0,
		autoCompactEnabled: false,
		subagentCount: 0,
		activeMs: 0,
		activeRepo: null,
		worktree: null,
		git: { branch: null, status: null, pr: null },
		usage: null,
	};
}

describe("status line model segment advisor badge", () => {
	it("appends a success-colored ++ badge when the advisor is active", () => {
		const rendered = renderSegment("model", createModelContext(true));
		expect(rendered.content).toContain("Test Model");
		// The badge carries the success color, kept distinct from the statusLineModel
		// name color (which several themes alias to `accent`).
		expect(rendered.content).toContain(theme.fg("success", "++"));
	});

	it("omits the badge when the advisor is inactive", () => {
		const rendered = renderSegment("model", createModelContext(false));
		expect(rendered.content).toContain("Test Model");
		expect(rendered.content).not.toContain("++");
	});
});

describe("status line model segment compact thinking level", () => {
	function createThinkingContext(
		compactThinkingLevel: boolean,
		configuredThinkingLevel: ConfiguredThinkingLevel = ThinkingLevel.High,
	): SegmentContext {
		return {
			...createModelContext(false),
			session: {
				state: {
					model: { id: "test-model", name: "Test Model", thinking: true },
					thinkingLevel:
						configuredThinkingLevel === ULTRA_THINKING ? ThinkingLevel.XHigh : configuredThinkingLevel,
				},
				isFastModeActive: () => false,
				isAutoThinking: false,
				autoResolvedThinkingLevel: () => undefined,
				configuredThinkingLevel: () => configuredThinkingLevel,
				isAdvisorActive: () => false,
			} as unknown as SegmentContext["session"],
			compactThinkingLevel,
		};
	}

	it("trails the level as a ` · <level>` suffix when compact mode is off", () => {
		const display = theme.thinking.high;
		const modelPrefix = theme.icon.model ? `${theme.icon.model} ` : "";
		const rendered = renderSegment("model", createThinkingContext(false));
		expect(Bun.stripANSI(rendered.content)).toBe(`${modelPrefix}Test Model${theme.sep.dot}${display}`);
	});

	it("swaps the model icon for the level glyph and drops the suffix when compact", () => {
		const display = theme.thinking.high;
		const glyph = display.includes(" ") ? display.slice(0, display.indexOf(" ")) : display;
		const rendered = renderSegment("model", createThinkingContext(true));
		expect(Bun.stripANSI(rendered.content)).toBe(`${glyph} Test Model`);
		expect(Bun.stripANSI(rendered.content)).not.toContain(theme.sep.dot);
	});

	it("shows Ultra as the configured thinking tier instead of its xhigh provider effort", () => {
		const xhighDisplay = theme.thinking.xhigh;
		const space = xhighDisplay.indexOf(" ");
		const glyph = space === -1 ? xhighDisplay : xhighDisplay.slice(0, space);
		const modelPrefix = theme.icon.model ? `${theme.icon.model} ` : "";
		const rendered = renderSegment("model", createThinkingContext(false, ULTRA_THINKING));

		expect(Bun.stripANSI(rendered.content)).toBe(`${modelPrefix}Test Model${theme.sep.dot}${glyph} ultra`);
		expect(Bun.stripANSI(rendered.content)).not.toContain("xhigh");
	});

	it("keeps Ultra visibly distinct from xhigh when compact thinking is enabled", () => {
		const xhighDisplay = theme.thinking.xhigh;
		const space = xhighDisplay.indexOf(" ");
		const glyph = space === -1 ? xhighDisplay : xhighDisplay.slice(0, space);
		const modelPrefix = theme.icon.model ? `${theme.icon.model} ` : "";
		const ultra = renderSegment("model", createThinkingContext(true, ULTRA_THINKING));
		const xhigh = renderSegment("model", createThinkingContext(true, ThinkingLevel.XHigh));

		expect(Bun.stripANSI(ultra.content)).toBe(`${modelPrefix}Test Model${theme.sep.dot}${glyph} ultra`);
		expect(Bun.stripANSI(xhigh.content)).toBe(`${glyph} Test Model`);
		expect(Bun.stripANSI(ultra.content)).not.toBe(Bun.stripANSI(xhigh.content));
	});
});

describe("Ultra public command surface", () => {
	it("is selected through thinking and has no slash-mode command or legacy alias", () => {
		const commands = BUILTIN_SLASH_COMMAND_DEFS.map(command => command.name);
		expect(commands).not.toContain("ultra");
		expect(commands).not.toContain("delegate");
		expect(commands).not.toContain("vibe");
	});
});
