import { describe, expect, it } from "bun:test";
import { getDocFilenames } from "@oh-my-pi/pi-coding-agent/internal-urls/docs-index";
import { BUILTIN_TOOL_NAMES } from "@oh-my-pi/pi-coding-agent/tools/builtin-names";

// Every shipped built-in tool that is exposed to the model in normal sessions
// must have a docs/tools/<name>.md root doc served by `pi://`. File names use
// underscores or hyphens; the test accepts either form so renaming the on-disk
// page does not require coordinating with the wire name.
const publicDocPaths = new Set(getDocFilenames());

const expectedDocPaths = (name: string): string[] => [`tools/${name}.md`, `tools/${name.replace(/_/g, "-")}.md`];

// Custom tools injected by the SDK (`packages/coding-agent/src/sdk.ts`) when
// their settings are enabled. Built-in tool factories live in BUILTIN_TOOLS but
// these custom tools are not present there, so the coverage list is explicit.
const CUSTOM_TOOL_NAMES = ["generate_image"] as const;

describe("pi:// root docs coverage", () => {
	it.each([...BUILTIN_TOOL_NAMES])("documents builtin tool %s", name => {
		const candidates = expectedDocPaths(name);
		const present = candidates.find(candidate => publicDocPaths.has(candidate));
		expect(
			present,
			`Missing docs/tools/<name>.md for built-in tool "${name}". Tried: ${candidates.join(", ")}.`,
		).toBeDefined();
	});

	it.each([...CUSTOM_TOOL_NAMES])("documents injected custom tool %s", name => {
		const candidates = expectedDocPaths(name);
		const present = candidates.find(candidate => publicDocPaths.has(candidate));
		expect(present, `Missing docs/tools/<name>.md for injected custom tool "${name}".`).toBeDefined();
	});

	it("omits documentation for disabled tools", () => {
		for (const name of ["debug", "eval", "github", "manage_skill", "ssh", "tts"]) {
			expect(publicDocPaths.has(`tools/${name}.md`), name).toBe(false);
		}
	});
});
