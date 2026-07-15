export const BUILTIN_TOOL_NAMES = [
	"read",
	"bash",
	"launch",
	"edit",
	"ast_grep",
	"ast_edit",
	"ask",
	"glob",
	"grep",
	"lsp",
	"inspect_image",
	"browser",
	"checkpoint",
	"rewind",
	"task",
	"job",
	"irc",
	"todo",
	"web_search",
	"search_tool_bm25",
	"write",
	"memory_edit",
	"retain",
	"recall",
	"reflect",
	"learn",
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

/** Upstream tool IDs that Pi reserves so extensions cannot reactivate disabled built-ins. */
export const PI_DISABLED_TOOL_NAMES: ReadonlySet<string> = new Set([
	"debug",
	"eval",
	"github",
	"manage_skill",
	"ssh",
	"tts",
]);

export function isPiDisabledToolName(name: string): boolean {
	return PI_DISABLED_TOOL_NAMES.has(name.toLowerCase());
}

/**
 * Retained Pi built-ins whose narrowed semantics must not be replaced by an
 * extension, SDK custom tool, MCP tool, or plugin reload.
 */
export const PI_PROTECTED_BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set(["learn"]);

export function isPiProtectedBuiltinToolName(name: string): boolean {
	return PI_PROTECTED_BUILTIN_TOOL_NAMES.has(name.toLowerCase());
}

const LEGACY_BUILTIN_TOOL_NAME_ALIASES: ReadonlyMap<string, BuiltinToolName> = new Map([
	["search", "grep"],
	["find", "glob"],
]);

/** Return the canonical tool name for current and legacy built-in tool IDs. */
export function normalizeToolName(name: string): string {
	const normalized = name.toLowerCase();
	return LEGACY_BUILTIN_TOOL_NAME_ALIASES.get(normalized) ?? normalized;
}

/** Normalize and deduplicate tool names while preserving first-seen order. */
export function normalizeToolNames(names: Iterable<string>): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const name of names) {
		const normalized = normalizeToolName(name);
		if (seen.has(normalized)) continue;
		seen.add(normalized);
		out.push(normalized);
	}
	return out;
}
