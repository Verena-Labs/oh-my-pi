/** Upstream slash-command IDs that Pi reserves across every command source. */
export const PI_DISABLED_SLASH_COMMAND_NAMES: ReadonlySet<string> = new Set([
	"autoresearch",
	"drop",
	"fresh",
	"green",
	"handoff",
	"move",
	"omfg",
	"retry",
	"shake",
	"ssh",
	"tan",
	"tree",
]);

/**
 * Return whether a slash-command name is reserved by Pi.
 *
 * Colons delimit command namespaces at the protocol boundary. Reserving the
 * root prevents a custom command such as `ssh:connect` from bypassing the
 * disabled `/ssh` surface while leaving unrelated namespaces (for example
 * `skill:ssh`) available.
 */
export function isPiDisabledSlashCommandName(name: string): boolean {
	const normalized = name.startsWith("/") ? name.slice(1).toLowerCase() : name.toLowerCase();
	const colonIndex = normalized.indexOf(":");
	const rootName = colonIndex === -1 ? normalized : normalized.slice(0, colonIndex);
	return PI_DISABLED_SLASH_COMMAND_NAMES.has(rootName);
}
