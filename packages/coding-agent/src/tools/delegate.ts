/**
 * Delegate mode tools — the director's entire non-read surface.
 *
 * Five thin tools over {@link DelegateSessionRegistry}: spawn/send/wait/kill/list
 * persistent worker sessions ("fast"/"good" CLIs). Spawns and sends return
 * immediately; turn results self-deliver through the async job manager.
 *
 * The TUI renderers lean into the "you are driving little CLIs" fiction:
 * spawn/send draw a mini composer (a message typed into a tiny Claude-Code-like
 * terminal), and wait/list draw the "TV wall" — one live screen per worker,
 * stacked, each showing its tool calls and streamed text as it works.
 */
import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { prompt } from "@oh-my-pi/pi-utils";
import { type } from "arktype";
import {
	type DelegateCli,
	type DelegateKillOutcome,
	type DelegateScreenSnapshot,
	type DelegateSendOutcome,
	DelegateSessionRegistry,
	type DelegateSessionState,
	type DelegateWaitOutcome,
} from "../delegate/runtime";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import { shimmerEnabled, shimmerText } from "../modes/theme/shimmer";
import type { Theme } from "../modes/theme/theme";
import delegateKillDescription from "../prompts/tools/delegate-kill.md" with { type: "text" };
import delegateListDescription from "../prompts/tools/delegate-list.md" with { type: "text" };
import delegateSendDescription from "../prompts/tools/delegate-send.md" with { type: "text" };
import delegateSpawnDescription from "../prompts/tools/delegate-spawn.md" with { type: "text" };
import delegateWaitDescription from "../prompts/tools/delegate-wait.md" with { type: "text" };
import { MAIN_AGENT_ID } from "../registry/agent-registry";
import { oneLineLabel } from "../task/types";
import { renderStatusLine } from "../tui";
import type { Tool, ToolSession } from "./index";
import {
	Ellipsis,
	formatBadge,
	formatDuration,
	formatStatusIcon,
	replaceTabs,
	type ToolUIColor,
	type ToolUIStatus,
	truncateToWidth,
} from "./render-utils";

export const DELEGATE_TOOL_NAMES = [
	"delegate_spawn",
	"delegate_send",
	"delegate_wait",
	"delegate_kill",
	"delegate_list",
] as const;

const delegateSpawnSchema = type({
	cli: type("'fast' | 'good'").describe(
		"worker flavor: fast = low-latency model for mechanical work; good = strong model for hard work",
	),
	"name?": type("string <= 48").describe("optional session name; generated when omitted"),
	prompt: type("string > 0").describe("first instruction; the worker starts with no other context"),
});

const delegateSendSchema = type({
	session: type("string > 0").describe("session id from delegate_spawn / delegate_list"),
	message: type("string > 0").describe("message for the session; steers mid-turn, else runs as its next turn"),
});

const delegateWaitSchema = type({
	"sessions?": type("string[]").describe("session ids to watch; omit to watch every session with a turn in flight"),
	"timeout?": type("number > 0").describe("max seconds to wait (default 30)"),
});

const delegateKillSchema = type({
	session: type("string > 0").describe("session id to terminate"),
});

const delegateListSchema = type({});

type DelegateOp = "spawn" | "send" | "wait" | "kill" | "list";

/** Details payload shared by every delegate tool for TUI rendering. */
export interface DelegateToolDetails {
	op: DelegateOp;
	/** Live TV-wall snapshot of the owner's worker sessions at (or during) the call. */
	screens: DelegateScreenSnapshot[];
	spawned?: { id: string; cli: DelegateCli; jobId: string };
	send?: DelegateSendOutcome;
	wait?: {
		settled: Array<{ id: string; jobId: string; status: "completed" | "failed" | "cancelled" }>;
		stillRunning: string[];
		timedOut: boolean;
		/** True on interim progress emissions while the wait is still blocking. */
		waiting?: boolean;
	};
	killed?: DelegateKillOutcome;
}

function screensOf(session: ToolSession, ids?: string[]): DelegateScreenSnapshot[] {
	return DelegateSessionRegistry.global().screens(session.getAgentId?.() ?? MAIN_AGENT_ID, ids);
}

function textResult(text: string, details: DelegateToolDetails): AgentToolResult<DelegateToolDetails> {
	return { content: [{ type: "text", text }], details };
}

export class DelegateSpawnTool implements AgentTool<typeof delegateSpawnSchema, DelegateToolDetails> {
	readonly name = "delegate_spawn";
	readonly approval = "exec" as const;
	readonly label = "Delegate Spawn";
	readonly summary = "Start a persistent fast/good worker session";
	readonly description: string;
	readonly parameters = delegateSpawnSchema;
	readonly strict = true;
	constructor(private readonly session: ToolSession) {
		this.description = prompt.render(delegateSpawnDescription);
	}

	async execute(
		_toolCallId: string,
		params: typeof delegateSpawnSchema.infer,
	): Promise<AgentToolResult<DelegateToolDetails>> {
		const { id, jobId } = await DelegateSessionRegistry.global().spawn(this.session, params);
		return textResult(
			`Spawned ${params.cli} session \`${id}\` (turn job \`${jobId}\`). The turn result will be delivered when it finishes — keep directing other sessions meanwhile. Continue this one with delegate_send \`${id}\`.`,
			{ op: "spawn", screens: screensOf(this.session), spawned: { id, cli: params.cli, jobId } },
		);
	}
}

export class DelegateSendTool implements AgentTool<typeof delegateSendSchema, DelegateToolDetails> {
	readonly name = "delegate_send";
	readonly approval = "exec" as const;
	readonly label = "Delegate Send";
	readonly summary = "Message a worker session (steer or next turn)";
	readonly description: string;
	readonly parameters = delegateSendSchema;
	readonly strict = true;
	constructor(private readonly session: ToolSession) {
		this.description = prompt.render(delegateSendDescription);
	}

	async execute(
		_toolCallId: string,
		params: typeof delegateSendSchema.infer,
	): Promise<AgentToolResult<DelegateToolDetails>> {
		const outcome = await DelegateSessionRegistry.global().send(this.session, params);
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

export class DelegateWaitTool implements AgentTool<typeof delegateWaitSchema, DelegateToolDetails> {
	readonly name = "delegate_wait";
	readonly approval = "read" as const;
	readonly label = "Delegate Wait";
	readonly summary = "Block until a worker session finishes its turn";
	readonly description: string;
	readonly parameters = delegateWaitSchema;
	readonly strict = true;
	readonly interruptible = true;
	constructor(private readonly session: ToolSession) {
		this.description = prompt.render(delegateWaitDescription);
	}

	async execute(
		_toolCallId: string,
		params: typeof delegateWaitSchema.infer,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<DelegateToolDetails>,
	): Promise<AgentToolResult<DelegateToolDetails>> {
		const registry = DelegateSessionRegistry.global();
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
		let outcome: DelegateWaitOutcome;
		try {
			outcome = await registry.wait(this.session, {
				sessions: params.sessions,
				timeoutMs: params.timeout !== undefined ? params.timeout * 1000 : undefined,
				signal,
			});
		} finally {
			clearInterval(progressTimer);
		}
		const details: DelegateToolDetails = {
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
			lines.push("Wait window elapsed before any turn settled — re-issue delegate_wait to keep waiting.");
		}
		const result = textResult(lines.join("\n").trimEnd(), details);
		// A pure "still waiting" frame is noise once a newer wait exists.
		return outcome.settled.length === 0 ? { ...result, useless: true } : result;
	}
}

export class DelegateKillTool implements AgentTool<typeof delegateKillSchema, DelegateToolDetails> {
	readonly name = "delegate_kill";
	readonly approval = "read" as const;
	readonly label = "Delegate Kill";
	readonly summary = "Terminate a worker session";
	readonly description: string;
	readonly parameters = delegateKillSchema;
	readonly strict = true;
	constructor(private readonly session: ToolSession) {
		this.description = prompt.render(delegateKillDescription);
	}

	async execute(
		_toolCallId: string,
		params: typeof delegateKillSchema.infer,
	): Promise<AgentToolResult<DelegateToolDetails>> {
		const outcome = await DelegateSessionRegistry.global().kill(this.session, params.session);
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

export class DelegateListTool implements AgentTool<typeof delegateListSchema, DelegateToolDetails> {
	readonly name = "delegate_list";
	readonly approval = "read" as const;
	readonly label = "Delegate List";
	readonly summary = "List worker sessions and their states";
	readonly description: string;
	readonly parameters = delegateListSchema;
	readonly strict = true;
	constructor(private readonly session: ToolSession) {
		this.description = prompt.render(delegateListDescription);
	}

	async execute(): Promise<AgentToolResult<DelegateToolDetails>> {
		const screens = screensOf(this.session);
		const details: DelegateToolDetails = { op: "list", screens };
		if (screens.length === 0) {
			return textResult("No delegate sessions. Spawn one with delegate_spawn.", details);
		}
		const lines = screens.map(screen => {
			const parts = [
				`- \`${screen.id}\` [${screen.cli}] ${screen.state}`,
				`${screen.turns} turn${screen.turns === 1 ? "" : "s"}`,
			];
			if (screen.queued > 0) parts.push(`${screen.queued} queued`);
			if (screen.model) parts.push(screen.model);
			if (screen.lastActivity) parts.push(`last: ${screen.lastActivity}`);
			return parts.join(" · ");
		});
		return textResult(lines.join("\n"), details);
	}
}

/** Creates the ephemeral tools installed while `/delegate` mode is active. */
export function createDelegateTools(session: ToolSession): Tool[] {
	return [
		new DelegateSpawnTool(session),
		new DelegateSendTool(session),
		new DelegateWaitTool(session),
		new DelegateKillTool(session),
		new DelegateListTool(session),
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

function stateToIcon(state: DelegateSessionState): ToolUIStatus {
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

function stateToColor(state: DelegateSessionState): ToolUIColor {
	switch (state) {
		case "running":
			return "accent";
		case "starting":
			return "accent";
		case "idle":
			return "success";
		case "dead":
			return "muted";
	}
}

interface DelegateRenderArgs {
	cli?: DelegateCli;
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
	screen: DelegateScreenSnapshot,
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
	const badge = formatBadge(screen.cli, stateToColor(screen.state), uiTheme);
	const idText =
		live && options.spinnerFrame !== undefined && shimmerEnabled()
			? shimmerText(screen.id, uiTheme)
			: uiTheme.fg(live ? "accent" : "toolOutput", screen.id);
	const headParts = [icon, badge, idText, uiTheme.fg("dim", settledStatus ?? screen.state)];
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

function describeCall(op: DelegateOp, args: DelegateRenderArgs | undefined): string {
	switch (op) {
		case "spawn":
			return `spawn ${args?.cli ?? "?"}${args?.name ? ` · ${frameText(args.name, 40)}` : ""}`;
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

/** Build the shared delegate renderer for one tool name. */
export function createDelegateToolRenderer(op: DelegateOp) {
	const composerOp = op === "spawn" || op === "send";
	return {
		inline: true,
		mergeCallAndResult: true,
		animatedPendingPreview: composerOp,
		animatedPartialResult: op === "wait",

		renderCall(args: DelegateRenderArgs, options: RenderResultOptions, uiTheme: Theme): Component {
			const title = uiTheme.fg("muted", `delegate ${describeCall(op, args)}`);
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
				renderStatusLine({ icon: "pending", title: `delegate ${describeCall(op, args)}` }, uiTheme),
				0,
				0,
			);
		},

		renderResult(
			result: { content: Array<{ type: string; text?: string }>; details?: DelegateToolDetails; isError?: boolean },
			options: RenderResultOptions,
			uiTheme: Theme,
			args?: DelegateRenderArgs,
		): Component {
			const details = result.details;
			if (!details || result.isError) {
				const fallback = result.content.find(part => part.type === "text")?.text ?? "";
				const header = renderStatusLine(
					{ icon: result.isError ? "error" : "done", title: `delegate ${describeCall(op, args)}` },
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
						? `${uiTheme.fg("muted", "delegate spawn")} ${formatBadge(details.spawned?.cli ?? args?.cli ?? "?", "accent", uiTheme)} ${uiTheme.fg("accent", frameText(details.spawned?.id ?? args?.name ?? "", 40))}`
						: `${uiTheme.fg("muted", "delegate send →")} ${uiTheme.fg("accent", frameText(args?.session ?? "?", 40))}`;
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
						title: `delegate kill ${frameText(details.killed?.id ?? args?.session ?? "?", 40)}${killedNote}`,
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
						{ icon: "warning", title: `delegate ${op}`, meta: [uiTheme.fg("dim", frameText(fallback, 60))] },
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
							? "delegate wait — watching the wall"
							: "delegate wait"
						: `delegate sessions (${screens.length})`;
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
