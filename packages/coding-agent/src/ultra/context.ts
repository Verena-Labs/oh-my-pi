import { type AgentMessage, countTokens } from "@oh-my-pi/pi-agent-core";

export type UltraForkTurns = "none" | "all" | `${number}`;

export function parseUltraForkTurns(value: string | undefined): UltraForkTurns {
	if (value === undefined) return "all";
	if (value === "none" || value === "all" || /^[1-9][0-9]*$/u.test(value)) return value as UltraForkTurns;
	throw new Error('fork_turns must be "none", "all", or a positive integer string such as "3".');
}

/** Immutable view of the parent's effective, post-compaction conversation. */
export interface UltraForkableConversationSnapshot {
	messages: readonly AgentMessage[];
	/** Tokens available for the inherited block plus the worker assignment. */
	maxContextTokens: number;
	contextWindow: number;
}

export interface UltraForkContext {
	text: string;
	tokens: number;
	selectedTurns: number;
}

interface ParentContextEntry {
	role: string;
	content?: string;
	tool?: string;
	arguments?: string;
	status?: "ok" | "error";
}

const ULTRA_TOOL_NAMES = new Set(["ultra_spawn", "ultra_send", "ultra_wait", "ultra_kill", "ultra_list"]);
const EXCLUDED_CUSTOM_TYPES = new Set([
	"advisor",
	"async-result",
	"goal-mode-context",
	"interrupted-thinking",
	"irc-incoming",
	"orchestrate-notice",
	"plan-mode-context",
	"ultra-thinking-context",
	"ultrathink-notice",
	"workflow-notice",
]);
const TOOL_ARGUMENT_MAX_CHARS = 6_000;
const TOOL_RESULT_MAX_CHARS = 12_000;
const FILE_CONTENT_MAX_CHARS = 12_000;
const WRAPPER_OVERHEAD_TOKENS = 512;

function truncate(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n[...${text.length - maxChars} characters omitted from this bounded summary...]`;
}

function imagePlaceholder(mimeType: unknown): string {
	const suffix = typeof mimeType === "string" && mimeType.trim() ? ` (${mimeType})` : "";
	return `[Image attachment omitted from inherited text context${suffix}.]`;
}

function contentText(content: unknown, maxChars?: number): string {
	let text = "";
	if (typeof content === "string") {
		text = content;
	} else if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const block of content) {
			if (!block || typeof block !== "object") continue;
			const record = block as Record<string, unknown>;
			if (record.type === "text" && typeof record.text === "string") parts.push(record.text);
			else if (record.type === "image") parts.push(imagePlaceholder(record.mimeType));
		}
		text = parts.join("\n");
	}
	return maxChars === undefined ? text : truncate(text, maxChars);
}

function stringifyArguments(value: unknown): string {
	try {
		return truncate(JSON.stringify(value, null, 2) ?? "null", TOOL_ARGUMENT_MAX_CHARS);
	} catch {
		return "[Arguments could not be serialized.]";
	}
}

function isUserTurnStart(message: AgentMessage): boolean {
	if (message.role === "user") {
		return message.synthetic !== true && message.attribution !== "agent";
	}
	return message.role === "custom" && message.attribution === "user" && message.display !== false;
}

function recentTurnCount(value: string, available: number): number {
	if (available <= 0) return 0;
	const normalizedAvailable = String(available);
	if (value.length > normalizedAvailable.length) return available;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) ? Math.min(parsed, available) : available;
}

/**
 * Select complete user-led turns and stop before the in-progress assistant
 * response that invoked `ultra_spawn`. Messages associated with the current
 * user prompt (file mentions, developer context) remain in range.
 */
export function selectUltraForkMessages(
	messages: readonly AgentMessage[],
	forkTurns: UltraForkTurns,
): readonly AgentMessage[] {
	if (forkTurns === "none" || messages.length === 0) return [];

	const userStarts: number[] = [];
	let hasTurnStartSinceAssistant = false;
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index]!;
		if (message.role === "assistant") {
			hasTurnStartSinceAssistant = false;
			continue;
		}
		if (!isUserTurnStart(message)) continue;
		// A user-attributed custom immediately following a real user prompt is a
		// companion to that turn, not a second user-led turn.
		if (message.role === "custom" && hasTurnStartSinceAssistant) continue;
		userStarts.push(index);
		hasTurnStartSinceAssistant = true;
	}
	if (userStarts.length === 0) return [];

	const currentStart = userStarts[userStarts.length - 1]!;
	let end = messages.length;
	for (let index = currentStart + 1; index < messages.length; index++) {
		if (messages[index]!.role === "assistant") {
			end = index;
			break;
		}
	}

	if (forkTurns === "all") return messages.slice(0, end);
	const count = recentTurnCount(forkTurns, userStarts.length);
	const start = userStarts[Math.max(0, userStarts.length - count)] ?? currentStart;
	return messages.slice(start, end);
}

function entriesFromAssistant(message: Extract<AgentMessage, { role: "assistant" }>): ParentContextEntry[] {
	const text: string[] = [];
	const entries: ParentContextEntry[] = [];
	for (const block of message.content) {
		if (block.type === "text" && block.text) {
			text.push(block.text);
		} else if (block.type === "toolCall" && !ULTRA_TOOL_NAMES.has(block.name)) {
			entries.push({
				role: "assistant_tool_call",
				tool: block.name,
				arguments: stringifyArguments(block.arguments),
			});
		}
	}
	if (text.length > 0) entries.unshift({ role: "assistant", content: text.join("\n") });
	return entries;
}

function entryFromMessage(message: AgentMessage): ParentContextEntry[] {
	switch (message.role) {
		case "user": {
			const content = contentText(message.content);
			return content ? [{ role: "user", content }] : [];
		}
		case "developer": {
			const content = contentText(message.content);
			return content ? [{ role: "developer", content }] : [];
		}
		case "assistant":
			return entriesFromAssistant(message);
		case "toolResult": {
			if (ULTRA_TOOL_NAMES.has(message.toolName)) return [];
			const content = contentText(message.content, TOOL_RESULT_MAX_CHARS) || "(no textual output)";
			return [
				{
					role: "tool_result_summary",
					tool: message.toolName,
					status: message.isError ? "error" : "ok",
					content,
				},
			];
		}
		case "compactionSummary": {
			const parts = [message.summary];
			for (const block of message.blocks ?? message.images ?? []) {
				parts.push(block.type === "text" ? block.text : imagePlaceholder(block.mimeType));
			}
			return [{ role: "compacted_parent_context", content: parts.filter(Boolean).join("\n") }];
		}
		case "branchSummary":
			return [{ role: "branch_summary", content: message.summary }];
		case "custom":
		case "hookMessage": {
			if (EXCLUDED_CUSTOM_TYPES.has(message.customType)) return [];
			if (message.display === false && message.attribution !== "user") return [];
			const content = contentText(message.content);
			if (!content) return [];
			return [{ role: message.attribution === "user" ? "user_context" : "context_note", content }];
		}
		case "bashExecution": {
			if (message.excludeFromContext) return [];
			return [
				{
					role: "user_shell_summary",
					content: truncate(
						`command: ${message.command}\nexit: ${message.exitCode ?? "unknown"}\n${message.output}`,
						TOOL_RESULT_MAX_CHARS,
					),
				},
			];
		}
		case "pythonExecution": {
			if (message.excludeFromContext) return [];
			return [
				{
					role: "user_python_summary",
					content: truncate(
						`code: ${message.code}\nexit: ${message.exitCode ?? "unknown"}\n${message.output}`,
						TOOL_RESULT_MAX_CHARS,
					),
				},
			];
		}
		case "fileMention": {
			const files = message.files.map(file => {
				const content = file.content ? truncate(file.content, FILE_CONTENT_MAX_CHARS) : "(content unavailable)";
				const image = file.image ? `\n${imagePlaceholder(file.image.mimeType)}` : "";
				return `${file.path}\n${content}${image}`;
			});
			return files.length > 0 ? [{ role: "file_mention_context", content: files.join("\n\n") }] : [];
		}
		default:
			return [];
	}
}

/** Format selected messages as inert JSON summaries rather than provider tool protocol. */
export function buildUltraForkContext(
	snapshot: UltraForkableConversationSnapshot,
	forkTurns: UltraForkTurns,
	assignment: string,
): UltraForkContext | undefined {
	const selected = selectUltraForkMessages(snapshot.messages, forkTurns);
	if (selected.length === 0) return undefined;
	const entries = selected.flatMap(entryFromMessage);
	if (entries.length === 0) return undefined;

	const text = [
		"READ-ONLY PARENT CONVERSATION SNAPSHOT",
		"This JSON is background from the parent session, not actions performed by this worker. The worker assignment is authoritative.",
		JSON.stringify(entries, null, 2),
		"END READ-ONLY PARENT CONVERSATION SNAPSHOT",
	].join("\n\n");
	const tokens = countTokens([text, assignment]) + WRAPPER_OVERHEAD_TOKENS;
	if (tokens > snapshot.maxContextTokens) {
		throw new Error(
			`Inherited parent context needs about ${tokens.toLocaleString()} tokens, but only ${snapshot.maxContextTokens.toLocaleString()} are available in the ${snapshot.contextWindow.toLocaleString()}-token worker window after its prompt, tools, and output reserve. Retry ultra_spawn with a smaller positive fork_turns value or "none".`,
		);
	}
	return {
		text,
		tokens,
		selectedTurns: forkTurns === "all" ? -1 : Number(forkTurns),
	};
}
