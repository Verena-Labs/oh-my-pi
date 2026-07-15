import { afterEach, describe, expect, it, vi } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { getExtraHelpText, parseArgs } from "@oh-my-pi/pi-coding-agent/cli/args";
import { getEmbeddedDoc } from "@oh-my-pi/pi-coding-agent/internal-urls/docs-index";
import { renderCommandHelp } from "@oh-my-pi/pi-utils/cli";
import Launch from "../../src/commands/launch";
import Read from "../../src/commands/read";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Pi public help boundary", () => {
	it("advertises retained tools and model-provider credentials without disabled eval or search surfaces", () => {
		const help = stripVTControlCharacters(getExtraHelpText());

		for (const tool of ["read", "bash", "edit", "write", "lsp", "web_search"]) {
			expect(help).toMatch(new RegExp(`^  ${tool}\\s+-`, "m"));
		}
		for (const disabledTool of ["python", "notebook"]) {
			expect(help).not.toMatch(new RegExp(`^  ${disabledTool}\\s+-`, "m"));
		}

		for (const providerCredential of [
			"ANTHROPIC_API_KEY",
			"OPENAI_API_KEY",
			"GEMINI_API_KEY",
			"AZURE_OPENAI_API_KEY",
			"XAI_API_KEY",
			"ZAI_API_KEY",
			"UMANS_AI_CODING_PLAN_API_KEY",
			"AWS_PROFILE",
			"GOOGLE_APPLICATION_CREDENTIALS",
		]) {
			expect(help).toContain(providerCredential);
		}

		for (const disabledSearchCredential of [
			"UMANS_WEBSEARCH_PROVIDER",
			"EXA_API_KEY",
			"BRAVE_API_KEY",
			"PERPLEXITY_API_KEY",
			"PERPLEXITY_COOKIES",
			"TAVILY_API_KEY",
			"TINYFISH_API_KEY",
			"FIRECRAWL_API_KEY",
			"ANTHROPIC_SEARCH_API_KEY",
			"ANTHROPIC_SEARCH_BASE_URL",
		]) {
			expect(help).not.toContain(disabledSearchCredential);
		}

		expect(help).toContain("pi read pi://");
		expect(help).not.toContain("docs/environment-variables.md");
	});

	it("hides the removed rulebook subsystem while tolerating its legacy negative flag", () => {
		expect(Launch.flags).not.toHaveProperty("no-rules");
		const parsed = parseArgs(["--no-rules"]);
		expect(parsed.noRules).toBe(true);
		expect(parsed.unrecognizedFlags).toEqual([]);
		expect(parsed.messages).toEqual([]);
	});

	it("renders active read examples with Pi branding and selected internal protocols", () => {
		let output = "";
		vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
			output += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
			return true;
		});

		renderCommandHelp("pi", "read", Read);

		expect(output).toContain("pi read pi://");
		expect(output).toContain("pi read ssh://host/path/to/file.ts");
		expect(output).not.toMatch(/\bomp\b|omp:\/\/|~\/\.omp/i);
		for (const disabledProtocol of ["issue://", "pr://", "rule://"]) {
			expect(output).not.toContain(disabledProtocol);
		}
	});

	it("ships web-search help for exactly Codex and DuckDuckGo", async () => {
		const doc = await getEmbeddedDoc("tools/web_search.md");
		expect(doc).toBeDefined();
		expect(doc).toContain("`codex`");
		expect(doc).toContain("`duckduckgo`");
		expect(doc).toContain("`providers.webSearchFallback` defaults to `false`");

		for (const disabledProvider of [
			"Perplexity",
			"Gemini",
			"Anthropic web search",
			"xAI",
			"Z.AI",
			"Exa",
			"TinyFish",
			"Jina",
			"Kagi",
			"Tavily",
			"Firecrawl",
			"Brave",
			"SearXNG",
		]) {
			expect(doc).not.toContain(disabledProvider);
		}
	});
});
