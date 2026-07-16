/**
 * Ultra orchestration tools.
 *
 * Five thin tools over {@link UltraSessionRegistry}: spawn/send/wait/kill/list
 * persistent, fully capable worker sessions. Spawns and sends return
 * immediately; turn results self-deliver through the async job manager.
 *
 * The TUI renderers present spawn/send as a mini composer and wait/list as the
 * "TV wall" — one live screen per worker,
 * stacked, each showing its tool calls and streamed text as it works.
 */
import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { prompt } from "@oh-my-pi/pi-utils";
import { type } from "arktype";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import { shimmerEnabled, shimmerText } from "../modes/theme/shimmer";
import type { Theme } from "../modes/theme/theme";
import ultraKillDescription from "../prompts/tools/ultra-kill.md" with { type: "text" };
import ultraListDescription from "../prompts/tools/ultra-list.md" with { type: "text" };
import ultraSendDescription from "../prompts/tools/ultra-send.md" with { type: "text" };
import ultraSpawnDescription from "../prompts/tools/ultra-spawn.md" with { type: "text" };
import ultraWaitDescription from "../prompts/tools/ultra-wait.md" with { type: "text" };
import { MAIN_AGENT_ID } from "../registry/agent-registry";
import { oneLineLabel } from "../task/types";
import { renderStatusLine } from "../tui";
import {
	type UltraKillOutcome,
	type UltraScreenSnapshot,
	type UltraSendOutcome,
	UltraSessionRegistry,
	type UltraSessionState,
	type UltraWaitOutcome,
} from "../ultra/runtime";
import type { Tool, ToolSession } from "./index";
import {
	Ellipsis,
	formatDuration,
	formatStatusIcon,
	replaceTabs,
	type ToolUIStatus,
	truncateToWidth,
} from "./render-utils";

export const ULTRA_TOOL_NAMES = ["ultra_spawn", "ultra_send", "ultra_wait", "ultra_kill", "ultra_list"] as const;

const ultraSpawnSchema = type({
	"name?": type("string <= 48").describe("optional session name; generated when omitted"),
	prompt: type("string > 0").describe("first instruction; the worker starts with no other context"),
	"+": "reject",
});

const ultraSendSchema = type({
	session: type("string > 0").describe("session id from ultra_spawn / ultra_list"),
	message: type("string > 0").describe("message for the session; steers mid-turn, else runs as its next turn"),
});

const ultraWaitSchema = type({
	"sessions?": type("string[]").describe("session ids to watch; omit to watch every session with a turn in flight"),
	"timeout?": type("number > 0").describe("max seconds to wait (default 30)"),
});

const ultraKillSchema = type({
	session: type("string > 0").describe("session id to terminate"),
});

const ultraListSchema = type({});

type UltraOp = "spawn" | "send" | "wait" | "kill" | "list";

/** Details payload shared by every ultra tool for TUI rendering. */
export interface UltraToolDetails {
	op: UltraOp;
	/** Live TV-wall snapshot of the owner's worker sessions at (or during) the call. */
	screens: UltraScreenSnapshot[];
	spawned?: { id: string; jobId: string };
	send?: UltraSendOutcome;
	wait?: {
		settled: Array<{ id: string; jobId: string; status: "completed" | "failed" | "cancelled" }>;
		stillRunning: string[];
		timedOut: boolean;
		/** True on interim progress emissions while the wait is still blocking. */
		waiting?: boolean;
	};
	killed?: UltraKillOutcome;
}

function screensOf(session: ToolSession, ids?: string[]): UltraScreenSnapshot[] {
	return UltraSessionRegistry.global().screens(session.getAgentId?.() ?? MAIN_AGENT_ID, ids);
}

function textResult(text: string, details: UltraToolDetails): AgentToolResult<UltraToolDetails> {
	return { content: [{ type: "text", text }], details };
}

export class UltraSpawnTool implements AgentTool<typeof ultraSpawnSchema, UltraToolDetails> {
	readonly name = "ultra_spawn";
	readonly approval = "exec" as const;
	readonly label = "Ultra Spawn";
	readonly summary = "Start a persistent fully capable worker session";
	readonly description: string;
	readonly parameters = ultraSpawnSchema;
	readonly strict = true;
	constructor(private readonly session: ToolSession) {
		this.description = prompt.render(ultraSpawnDescription);
	}

	async execute(
		_toolCallId: string,
		params: typeof ultraSpawnSchema.infer,
	): Promise<AgentToolResult<UltraToolDetails>> {
		const { id, jobId } = await UltraSessionRegistry.global().spawn(this.session, params);
		return textResult(
			`Spawned session \`${id}\` (turn job \`${jobId}\`). The turn result will be delivered when it finishes — keep directing other sessions meanwhile. Continue this one with ultra_send \`${id}\`.`,
			{ op: "spawn", screens: screensOf(this.session), spawned: { id, jobId } },
		);
	}
}

export class UltraSendTool implements AgentTool<typeof ultraSendSchema, UltraToolDetails> {
	readonly name = "ultra_send";
	readonly approval = "exec" as const;
	readonly label = "Ultra Send";
	readonly summary = "Message a worker session (steer or next turn)";
	readonly description: string;
	readonly parameters = ultraSendSchema;
	readonly strict = true;
	constructor(private readonly session: ToolSession) {
		this.description = prompt.render(ultraSendDescription);
	}

	async execute(
		_toolCallId: string,
		params: typeof ultraSendSchema.infer,
	): Promise<AgentToolResult<UltraToolDetails>> {
		const outcome = await UltraSessionRegistry.global().send(this.session, params);
		const ack =
			outcome.mode === "turn"
				? `Started a new turn on \`${outcome.id}\` (job \`${outcome.jobId}\`). Its result will be delivered when the turn finishes.`
				: outcome.mode === "steered"
					? `Steered \`${outcome.id}\` mid-turn — the running turn sees your message at its next step.`
					: `\`${outcome.id}\` is mid-turn; your message is queued and runs automatically as the next turn.`;
		return textResult(ack, { op: "send", screens: screensOf(this.session), send: outcome });
	}
}

const WAIT_PROGRESS_INTERVAL_MS = 500;

export class UltraWaitTool implements AgentTool<typeof ultraWaitSchema, UltraToolDetails> {
	readonly name = "ultra_wait";
	readonly approval = "read" as const;
	readonly label = "Ultra Wait";
	readonly summary = "Block until a worker session finishes its turn";
	readonly description: string;
	readonly parameters = ultraWaitSchema;
	readonly strict = true;
	readonly interruptible = true;
	constructor(private readonly session: ToolSession) {
		this.description = prompt.render(ultraWaitDescription);
	}

	async execute(
		_toolCallId: string,
		params: typeof ultraWaitSchema.infer,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<UltraToolDetails>,
	): Promise<AgentToolResult<UltraToolDetails>> {
		const registry = UltraSessionRegistry.global();
		// Live TV-wall frames while the wait blocks: each tick re-snapshots the
		// watched workers so their tool calls and streamed text play in place.
		const emitProgress = (): void => {
			onUpdate?.({
				content: [{ type: "text", text: "" }],
				details: {
					op: "wait",
					screens: screensOf(this.session, params.sessions),
					wait: { settled: [], stillRunning: [], timedOut: false, waiting: true },
				},
			});
		};
		const progressTimer = onUpdate ? setInterval(emitProgress, WAIT_PROGRESS_INTERVAL_MS) : undefined;
		emitProgress();
		let outcome: UltraWaitOutcome;
		try {
			outcome = await registry.wait(this.session, {
				sessions: params.sessions,
				timeoutMs: params.timeout !== undefined ? params.timeout * 1000 : undefined,
				signal,
			});
		} finally {
			clearInterval(progressTimer);
		}
		const details: UltraToolDetails = {
			op: "wait",
			screens: screensOf(this.session, params.sessions),
			wait: {
				settled: outcome.settled.map(({ id, jobId, status }) => ({ id, jobId, status })),
				stillRunning: outcome.stillRunning,
				timedOut: outcome.timedOut,
			},
		};
		if (outcome.settled.length === 0 && outcome.stillRunning.length === 0) {
			return { ...textResult("No turns in flight to wait for.", details), useless: true };
		}
		const lines: string[] = [];
		for (const entry of outcome.settled) {
			lines.push(`## \`${entry.id}\` — ${entry.status}`, entry.resultText, "");
		}
		if (outcome.stillRunning.length > 0) {
			lines.push(`Still running: ${outcome.stillRunning.map(id => `\`${id}\``).join(", ")}.`);
		}
		if (outcome.timedOut) {
			lines.push("Wait window elapsed before any turn settled — re-issue ultra_wait to keep waiting.");
		}
		const result = textResult(lines.join("\n").trimEnd(), details);
		// A pure "still waiting" frame is noise once a newer wait exists.
		return outcome.settled.length === 0 ? { ...result, useless: true } : result;
	}
}

export class UltraKillTool implements AgentTool<typeof ultraKillSchema, UltraToolDetails> {
	readonly name = "ultra_kill";
	readonly approval = "read" as const;
	readonly label = "Ultra Kill";
	readonly summary = "Terminate a worker session";
	readonly description: string;
	readonly parameters = ultraKillSchema;
	readonly strict = true;
	constructor(private readonly session: ToolSession) {
		this.description = prompt.render(ultraKillDescription);
	}

	async execute(
		_toolCallId: string,
		params: typeof ultraKillSchema.infer,
	): Promise<AgentToolResult<UltraToolDetails>> {
		const outcome = await UltraSessionRegistry.global().kill(this.session, params.session);
		const cancelNote = outcome.cancelledTurn ? " Its in-flight turn was cancelled." : "";
		return textResult(
			`Killed session \`${outcome.id}\`.${cancelNote} Transcript remains at history://${outcome.id}.`,
			{
				op: "kill",
				screens: screensOf(this.session),
				killed: outcome,
			},
		);
	}
}

export class UltraListTool implements AgentTool<typeof ultraListSchema, UltraToolDetails> {
	readonly name = "ultra_list";
	readonly approval = "read" as const;
	readonly label = "Ultra List";
	readonly summary = "List worker sessions and their states";
	readonly description: string;
	readonly parameters = ultraListSchema;
	readonly strict = true;
	constructor(private readonly session: ToolSession) {
		this.description = prompt.render(ultraListDescription);
	}

	async execute(): Promise<AgentToolResult<UltraToolDetails>> {
		const screens = screensOf(this.session);
		const details: UltraToolDetails = { op: "list", screens };
		if (screens.length === 0) {
			return textResult("No ultra sessions. Spawn one with ultra_spawn.", details);
		}
		const lines = screens.map(screen => {
			const parts = [`- \`${screen.id}\` ${screen.state}`, `${screen.turns} turn${screen.turns === 1 ? "" : "s"}`];
			if (screen.queued > 0) parts.push(`${screen.queued} queued`);
			if (screen.model) parts.push(screen.model);
			if (screen.lastActivity) parts.push(`last: ${screen.lastActivity}`);
			return parts.join(" · ");
		});
		return textResult(lines.join("\n"), details);
	}
}

/** Creates the orchestration tools installed while Ultra thinking is active. */
export function createUltraTools(session: ToolSession): Tool[] {
	return [
		new UltraSpawnTool(session),
		new UltraSendTool(session),
		new UltraWaitTool(session),
		new UltraKillTool(session),
		new UltraListTool(session),
	];
}

// =============================================================================
// TUI Renderer — mini composer (spawn/send) + TV wall (wait/list)
// =============================================================================

const COMPOSER_LINE_MAX = 96;
const TV_LINE_MAX = 110;
const TV_TRACE_COLLAPSED = 2;
const TV_TRACE_EXPANDED = 6;
const TV_OUTPUT_COLLAPSED = 1;
const TV_OUTPUT_EXPANDED = 3;
const CURSOR_GLYPH = "▌";

function stateToIcon(state: UltraSessionState): ToolUIStatus {
	switch (state) {
		case "running":
			return "running";
		case "starting":
			return "pending";
		case "idle":
			return "done";
		case "dead":
			return "aborted";
	}
}

interface UltraRenderArgs {
	prompt?: string;
	name?: string;
	session?: string;
	message?: string;
	sessions?: string[];
}

/** One-line, escape-stripped fragment for embedding in a frame row. */
function frameText(text: string, max: number): string {
	return oneLineLabel(replaceTabs(text), max);
}

/**
 * Draw a left-railed mini terminal:
 * ```
 * ╭─ <header>
 * │ <body…>
 * ╰─ <footer>
 * ```
 */
function miniFrame(uiTheme: Theme, header: string, body: string[], footer?: string): string[] {
	const box = uiTheme.boxRound;
	const rail = (glyph: string) => uiTheme.fg("dim", glyph);
	const lines = [`${rail(`${box.topLeft}${box.horizontal}`)} ${header}`];
	for (const row of body) {
		lines.push(`${rail(box.vertical)} ${row}`);
	}
	lines.push(
		footer ? `${rail(`${box.bottomLeft}${box.horizontal}`)} ${footer}` : rail(`${box.bottomLeft}${box.horizontal}`),
	);
	return lines;
}

/** The `>` composer rows of the mini CLI: the director's message being typed in. */
function composerRows(uiTheme: Theme, message: string, options: { cursor: boolean; expanded: boolean }): string[] {
	const promptGlyph = uiTheme.fg("accent", ">");
	const rawLines = message.split(/\r?\n/).filter(line => line.trim().length > 0);
	const maxRows = options.expanded ? 6 : 2;
	const visible = rawLines.slice(0, maxRows).map(line => frameText(line, COMPOSER_LINE_MAX));
	if (visible.length === 0) visible.push("");
	if (rawLines.length > maxRows) {
		visible[visible.length - 1] = `${visible[visible.length - 1]} …`;
	} else if (options.cursor) {
		visible[visible.length - 1] = `${visible[visible.length - 1]}${uiTheme.fg("accent", CURSOR_GLYPH)}`;
	}
	return visible.map((line, index) =>
		index === 0 ? `${promptGlyph} ${uiTheme.fg("toolOutput", line)}` : `  ${uiTheme.fg("toolOutput", line)}`,
	);
}

/** Render one worker "TV": header + live tool calls + streamed text tail. */
function tvScreen(
	uiTheme: Theme,
	screen: UltraScreenSnapshot,
	options: RenderResultOptions,
	settledStatus?: "completed" | "failed" | "cancelled",
): string[] {
	const live = screen.state === "running" || screen.state === "starting";
	const spinnerFrame = live ? options.spinnerFrame : undefined;
	const icon = formatStatusIcon(
		settledStatus === "failed" ? "error" : settledStatus === "cancelled" ? "aborted" : stateToIcon(screen.state),
		uiTheme,
		spinnerFrame,
	);
	const idText =
		live && options.spinnerFrame !== undefined && shimmerEnabled()
			? shimmerText(screen.id, uiTheme)
			: uiTheme.fg(live ? "accent" : "toolOutput", screen.id);
	const headParts = [icon, idText, uiTheme.fg("dim", settledStatus ?? screen.state)];
	const turnsLabel = `${screen.turns}t${screen.queued > 0 ? `+${screen.queued}q` : ""}`;
	headParts.push(uiTheme.fg("muted", turnsLabel));
	if (screen.turnStartedAt !== undefined) {
		headParts.push(uiTheme.fg("dim", formatDuration(Date.now() - screen.turnStartedAt)));
	}
	if (screen.model) headParts.push(uiTheme.fg("muted", frameText(screen.model, 40)));

	const body: string[] = [];
	const hook = uiTheme.tree.hook;
	if (live) {
		if (screen.turnMessage) {
			body.push(`${uiTheme.fg("accent", ">")} ${uiTheme.fg("dim", frameText(screen.turnMessage, TV_LINE_MAX))}`);
		}
		const traceCap = options.expanded ? TV_TRACE_EXPANDED : TV_TRACE_COLLAPSED;
		for (const line of screen.trace.slice(-traceCap)) {
			body.push(`${uiTheme.fg("dim", hook)} ${uiTheme.fg("dim", frameText(line, TV_LINE_MAX))}`);
		}
		if (screen.currentTool) {
			const detail = screen.lastIntent ?? screen.currentToolArgs;
			const label = `${screen.currentTool}${detail ? `: ${detail}` : ""}`;
			const painted =
				options.spinnerFrame !== undefined && shimmerEnabled()
					? shimmerText(frameText(label, TV_LINE_MAX), uiTheme)
					: uiTheme.fg("muted", frameText(label, TV_LINE_MAX));
			body.push(`${uiTheme.fg("accent", hook)} ${painted}`);
		} else if (screen.lastIntent) {
			body.push(`${uiTheme.fg("accent", hook)} ${uiTheme.fg("muted", frameText(screen.lastIntent, TV_LINE_MAX))}`);
		}
		const outputCap = options.expanded ? TV_OUTPUT_EXPANDED : TV_OUTPUT_COLLAPSED;
		for (const line of screen.outputTail.slice(-outputCap)) {
			if (line.trim().length === 0) continue;
			body.push(`  ${uiTheme.fg("muted", frameText(line, TV_LINE_MAX))}`);
		}
	} else if (screen.lastActivity) {
		body.push(`${uiTheme.fg("dim", hook)} ${uiTheme.fg("muted", frameText(screen.lastActivity, TV_LINE_MAX))}`);
	}
	const footer = settledStatus
		? uiTheme.fg(
				settledStatus === "completed" ? "success" : settledStatus === "failed" ? "error" : "warning",
				`turn ${settledStatus} — result delivered`,
			)
		: undefined;
	return miniFrame(uiTheme, headParts.join(" "), body, footer);
}

/**
 * Width-aware component over prebuilt lines, or — given a builder — lines
 * recomputed on every paint. Spinner ticks repaint the tool block WITHOUT
 * re-invoking renderCall/renderResult, so time-based content (shimmer sweep,
 * spinner glyph, cursor blink, elapsed turn duration) must be produced inside
 * a builder that reads the shared mutable `options` at paint time; prebuilt
 * arrays are for static frames only.
 */
function linesComponent(lines: string[] | (() => string[])): Component {
	return {
		render(width: number): readonly string[] {
			const rows = typeof lines === "function" ? lines() : lines;
			return rows.map(line => truncateToWidth(line, width, Ellipsis.Unicode));
		},
		invalidate() {},
	};
}

function describeCall(op: UltraOp, args: UltraRenderArgs | undefined): string {
	switch (op) {
		case "spawn":
			return `spawn${args?.name ? ` · ${frameText(args.name, 40)}` : ""}`;
		case "send":
			return `send → ${args?.session ? frameText(args.session, 40) : "?"}`;
		case "wait":
			return args?.sessions?.length
				? `wait on ${frameText(args.sessions.join(", "), 60)}`
				: "wait on running sessions";
		case "kill":
			return `kill ${args?.session ? frameText(args.session, 40) : "?"}`;
		case "list":
			return "sessions";
	}
}

/** Build the shared ultra renderer for one tool name. */
export function createUltraToolRenderer(op: UltraOp) {
	const composerOp = op === "spawn" || op === "send";
	return {
		inline: true,
		mergeCallAndResult: true,
		animatedPendingPreview: composerOp,
		animatedPartialResult: op === "wait",

		renderCall(args: UltraRenderArgs, options: RenderResultOptions, uiTheme: Theme): Component {
			const title = uiTheme.fg("muted", `ultra ${describeCall(op, args)}`);
			if (composerOp) {
				const message = op === "spawn" ? (args?.prompt ?? "") : (args?.message ?? "");
				return linesComponent(() => {
					const cursorOn = ((options.spinnerFrame ?? 0) & 1) === 0;
					return miniFrame(
						uiTheme,
						title,
						composerRows(uiTheme, message, { cursor: cursorOn, expanded: options.expanded }),
						uiTheme.fg("dim", op === "spawn" ? "booting CLI…" : "delivering…"),
					);
				});
			}
			return new Text(
				renderStatusLine({ icon: "pending", title: `ultra ${describeCall(op, args)}` }, uiTheme),
				0,
				0,
			);
		},

		renderResult(
			result: { content: Array<{ type: string; text?: string }>; details?: UltraToolDetails; isError?: boolean },
			options: RenderResultOptions,
			uiTheme: Theme,
			args?: UltraRenderArgs,
		): Component {
			const details = result.details;
			if (!details || result.isError) {
				const fallback = result.content.find(part => part.type === "text")?.text ?? "";
				const header = renderStatusLine(
					{ icon: result.isError ? "error" : "done", title: `ultra ${describeCall(op, args)}` },
					uiTheme,
				);
				const body = fallback
					? `\n  ${uiTheme.fg(result.isError ? "error" : "dim", frameText(fallback, TV_LINE_MAX))}`
					: "";
				return new Text(`${header}${body}`, 0, 0);
			}

			if (composerOp) {
				const message = op === "spawn" ? (args?.prompt ?? "") : (args?.message ?? "");
				const target =
					op === "spawn"
						? `${uiTheme.fg("muted", "ultra spawn")} ${uiTheme.fg("accent", frameText(details.spawned?.id ?? args?.name ?? "", 40))}`
						: `${uiTheme.fg("muted", "ultra send →")} ${uiTheme.fg("accent", frameText(args?.session ?? "?", 40))}`;
				const ack =
					op === "spawn"
						? uiTheme.fg("success", `turn started${details.spawned ? ` (job ${details.spawned.jobId})` : ""}`)
						: details.send?.mode === "steered"
							? uiTheme.fg("success", "steered into the running turn")
							: details.send?.mode === "queued"
								? uiTheme.fg("warning", "mid-turn — queued as the next turn")
								: uiTheme.fg(
										"success",
										`turn started${details.send?.jobId ? ` (job ${details.send.jobId})` : ""}`,
									);
				const lines = miniFrame(
					uiTheme,
					target,
					composerRows(uiTheme, message, { cursor: false, expanded: options.expanded }),
					ack,
				);
				return linesComponent(lines);
			}

			if (op === "kill") {
				const killedNote = details.killed?.cancelledTurn ? " (in-flight turn cancelled)" : "";
				const header = renderStatusLine(
					{
						icon: "done",
						title: `ultra kill ${frameText(details.killed?.id ?? args?.session ?? "?", 40)}${killedNote}`,
					},
					uiTheme,
				);
				return new Text(header, 0, 0);
			}

			// wait/list: the TV wall.
			const screens = details.screens;
			if (screens.length === 0) {
				const fallback = result.content.find(part => part.type === "text")?.text ?? "no sessions";
				return new Text(
					renderStatusLine(
						{ icon: "warning", title: `ultra ${op}`, meta: [uiTheme.fg("dim", frameText(fallback, 60))] },
						uiTheme,
					),
					0,
					0,
				);
			}
			const waiting = details.wait?.waiting === true;
			const settledById = new Map(details.wait?.settled.map(entry => [entry.id, entry.status] as const) ?? []);
			return linesComponent(() => {
				const running = screens.filter(screen => screen.state === "running" || screen.state === "starting").length;
				const meta: string[] = [];
				if (running > 0) meta.push(uiTheme.fg("accent", `${running} on air`));
				if (settledById.size > 0) meta.push(uiTheme.fg("success", `${settledById.size} settled`));
				if (details.wait?.timedOut) meta.push(uiTheme.fg("warning", "timed out"));
				const title =
					op === "wait"
						? waiting
							? "ultra wait — watching the wall"
							: "ultra wait"
						: `ultra sessions (${screens.length})`;
				const header = renderStatusLine(
					{
						icon: details.wait?.timedOut ? "warning" : running > 0 ? "info" : "done",
						spinnerFrame: running > 0 ? options.spinnerFrame : undefined,
						title,
						meta,
					},
					uiTheme,
				);
				const lines = [header];
				for (const screen of screens) {
					lines.push(...tvScreen(uiTheme, screen, options, settledById.get(screen.id)));
				}
				return lines;
			});
		},
	};
}
