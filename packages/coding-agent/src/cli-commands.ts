/**
 * Top-level CLI command table.
 *
 * Lives in its own module (importable without side effects) so that tests can
 * inspect the registered subcommands without triggering the side-effectful
 * top-level await in `cli.ts`. Adding a new subcommand here is enough to make
 * `runCli` route to it instead of forwarding the argv as a prompt to
 * `launch` — see #1496 for the original "args silently leak to the LLM"
 * regression that motivated the split.
 */
import type { CommandEntry } from "@oh-my-pi/pi-utils/cli";
import { flagConsumesValue } from "./cli/flag-tables";

export const commands: CommandEntry[] = [
	{ name: "launch", load: () => import("./commands/launch").then(m => m.default) },
	{ name: "agents", load: () => import("./commands/agents").then(m => m.default) },
	{ name: "bench", load: () => import("./commands/bench").then(m => m.default) },
	{ name: "completions", load: () => import("./commands/completions").then(m => m.default) },
	{ name: "__complete", load: () => import("./commands/complete").then(m => m.default) },
	{ name: "config", load: () => import("./commands/config").then(m => m.default) },
	{ name: "gc", load: () => import("./commands/gc").then(m => m.default) },
	{ name: "grep", load: () => import("./commands/grep").then(m => m.default) },
	{ name: "gallery", load: () => import("./commands/gallery").then(m => m.default) },
	{ name: "grievances", load: () => import("./commands/grievances").then(m => m.default) },
	{ name: "install", load: () => import("./commands/install").then(m => m.default) },
	{ name: "models", load: () => import("./commands/models").then(m => m.default) },
	{ name: "plugin", load: () => import("./commands/plugin").then(m => m.default) },
	{ name: "setup", load: () => import("./commands/setup").then(m => m.default) },
	{ name: "shell", load: () => import("./commands/shell").then(m => m.default) },
	{ name: "read", load: () => import("./commands/read").then(m => m.default) },
	{ name: "stats", load: () => import("./commands/stats").then(m => m.default) },
	{ name: "usage", load: () => import("./commands/usage").then(m => m.default) },
	{ name: "tiny-models", load: () => import("./commands/tiny-models").then(m => m.default) },
	{ name: "worktree", load: () => import("./commands/worktree").then(m => m.default), aliases: ["wt"] },
	{ name: "search", load: () => import("./commands/web-search").then(m => m.default), aliases: ["q"] },
];

// Documented-looking plugin/marketplace verbs that are NOT registered top-level
// commands. Without a guard `resolveCliArgv` rewrites e.g. `omp marketplace add
// xyz` to `omp launch marketplace add xyz`, silently forwarding the argv to the
// model as a prompt instead of managing plugins (#4845; same class as the
// `list`/`remove` leak fixed in #2935 and the `install` leak in #1496/#1498).
// The real commands live under `omp plugin <action>`; each entry maps a verb to
// a hint pointing there. See {@link reservedTopLevelWordMessage} for when a hint
// fires vs. when the argv still falls through to `launch`.
const RESERVED_TOP_LEVEL_WORDS: Record<string, string> = {
	extensions:
		'`pi extensions` is not a management command. Use `pi plugin list` / `pi plugin install`, or run `pi launch extensions` if you meant to send "extensions" as a prompt.',
	list: '`pi list` is not a top-level command. Use `pi plugin list` to list installed plugins, or run `pi launch list` if you meant to send "list" as a prompt.',
	remove:
		'`pi remove` is not a top-level command. Use `pi plugin uninstall <name>` to remove a plugin, or run `pi launch remove` if you meant to send "remove" as a prompt.',
	uninstall:
		'`pi uninstall` is not a top-level command. Use `pi plugin uninstall <name@marketplace>` to remove a plugin, or run `pi launch uninstall` if you meant to send "uninstall" as a prompt.',
	marketplace:
		'`pi marketplace` is not a top-level command. Use `pi plugin marketplace <add|remove|update|list>` to manage marketplaces, or run `pi launch marketplace` if you meant to send "marketplace" as a prompt.',
	discover:
		'`pi discover` is not a top-level command. Use `pi plugin discover [marketplace]` to browse available plugins, or run `pi launch discover` if you meant to send "discover" as a prompt.',
	upgrade:
		'`pi upgrade` is not a top-level command. Use `pi plugin upgrade [name@marketplace]` to upgrade plugins, or run `pi launch upgrade` if you meant to send "upgrade" as a prompt.',
	enable:
		'`pi enable` is not a top-level command. Use `pi plugin enable <name@marketplace>` to enable a plugin, or run `pi launch enable` if you meant to send "enable" as a prompt.',
	disable:
		'`pi disable` is not a top-level command. Use `pi plugin disable <name@marketplace>` to disable a plugin, or run `pi launch disable` if you meant to send "disable" as a prompt.',
};

const DISABLED_TOP_LEVEL_WORDS: Readonly<Record<string, string>> = {
	acp: "ACP is not available in Pi.",
	"auth-broker": "Remote credential brokers are not available in Pi.",
	"auth-gateway": "Remote credential gateways are not available in Pi.",
	commit: "The agentic commit wrapper is not available in Pi.",
	"dry-balance": "Credential-pool balancing is not available in Pi.",
	join: "Live collaboration is not available in Pi.",
	say: "Text-to-speech narration is not available in Pi.",
	ssh: "Dedicated SSH commands are not available in Pi; ssh:// resources remain supported.",
	token: "Credential-pool token selection is not available in Pi.",
	ttsr: "TTSR rule forging is not available in Pi.",
	update: "Pi executable updates are owned by the consuming distribution.",
};

// Sub-actions that make `omp marketplace <sub>` unambiguously a management
// command even when multi-word (the reporter's `omp marketplace add xyz`,
// #4845). Mirrors the switch in `handleMarketplace` (cli/plugin-cli.ts).
const MARKETPLACE_SUBCOMMANDS: Record<string, true> = { add: true, remove: true, rm: true, update: true, list: true };

/**
 * Hint for a reserved plugin/marketplace verb used as a top-level command, or
 * `undefined` when the argv should fall through to `launch`.
 *
 * A bare verb (`omp marketplace`) always hints. A multi-word invocation only
 * hints when the arguments follow the documented plugin grammar — a marketplace
 * sub-action (`omp marketplace add …`) or a `name@marketplace` plugin id
 * (`omp uninstall foo@bar`) — so genuine prompts that merely begin with one of
 * these words (`omp list all my files`, `omp upgrade the deps`) still launch.
 *
 * Flags (`-…`) and `@file` arguments in the verb slot are never management
 * commands; those fall through to the default `launch` command.
 */
export function reservedTopLevelWordMessage(argv: readonly string[]): string | undefined {
	const first = argv[0];
	if (!first || first.startsWith("-") || first.startsWith("@")) return undefined;
	const hint = RESERVED_TOP_LEVEL_WORDS[first];
	if (!hint) return undefined;
	const second = argv[1];
	if (second === undefined) return hint;
	if (first === "marketplace" && MARKETPLACE_SUBCOMMANDS[second]) return hint;
	for (let index = 1; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg.startsWith("-") && arg.includes("@")) return hint;
	}
	return undefined;
}

/**
 * Return true when `first` matches a registered subcommand name or alias.
 *
 * Flags (`-…`) and `@file` arguments are never subcommands; for those the CLI
 * runner skips ahead to the default `launch` command.
 */
export function isSubcommand(first: string | undefined): boolean {
	if (!first || first.startsWith("-") || first.startsWith("@")) return false;
	return commands.some(entry => entry.name === first || entry.aliases?.includes(first));
}

export type ResolvedCliArgv = { argv: string[] } | { error: string };

/**
 * Index of the first argv token that names a registered subcommand, skipping
 * leading global option flags (and any value they consume) with the same
 * contract as the launch parser ({@link flagConsumesValue}). Returns -1 when
 * scanning hits a non-subcommand positional, an end-of-options `--`, or the end
 * of argv first.
 */
function leadingSubcommandIndex(argv: string[]): number {
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--") return -1;
		if (!arg.startsWith("-")) return isSubcommand(arg) ? index : -1;
		if (flagConsumesValue(arg, argv[index + 1])) index += 1;
	}
	return -1;
}

/** Find the first positional command word without mistaking an option value for one. */
function leadingCommandWord(argv: string[]): string | undefined {
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--") return undefined;
		if (!arg.startsWith("-")) return arg;
		if (flagConsumesValue(arg, argv[index + 1])) index += 1;
	}
	return undefined;
}

/**
 * Decide what the CLI runner should do with raw argv: reject bare reserved
 * management words, pass help/version through untouched, route a recognized
 * subcommand (even behind leading global flags like `--approval-mode=yolo`) to
 * that command with the flags preserved, and forward everything else to
 * `launch` (#2970).
 */
export function resolveCliArgv(argv: string[]): ResolvedCliArgv {
	const first = argv[0];
	const disabledMessage = DISABLED_TOP_LEVEL_WORDS[leadingCommandWord(argv) ?? ""];
	if (disabledMessage) return { error: disabledMessage };
	const reservedMessage = reservedTopLevelWordMessage(argv);
	if (reservedMessage) return { error: reservedMessage };
	if (first === "--help" || first === "-h" || first === "--version" || first === "-v" || first === "help") {
		return { argv };
	}
	if (isSubcommand(first)) return { argv };
	// A subcommand can hide behind leading global option flags
	// (`pi --approval-mode=yolo models`). `run` dispatches strictly on argv[0], so
	// hoist the subcommand to the front and keep the leading flags as its own
	// argv; the command's parser then applies them. Genuine launch prompts (no
	// trailing subcommand) are untouched.
	const subIndex = leadingSubcommandIndex(argv);
	if (subIndex >= 0) {
		return { argv: [argv[subIndex], ...argv.slice(0, subIndex), ...argv.slice(subIndex + 1)] };
	}
	return { argv: ["launch", ...argv] };
}
