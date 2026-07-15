import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { setExcludedSearchProviders, setPreferredSearchProvider } from "@oh-my-pi/pi-coding-agent/web/search/provider";
import { __resetDirsFromEnvForTests, setAgentDir, TempDir } from "@oh-my-pi/pi-utils";
import { runSearchCommand } from "../../../src/cli/web-search-cli";

const WEB_SEARCH_ENV_KEYS = [
	"ANTHROPIC_API_KEY",
	"BRAVE_API_KEY",
	"EXA_API_KEY",
	"FIRECRAWL_API_KEY",
	"JINA_API_KEY",
	"KAGI_API_KEY",
	"MOONSHOT_API_KEY",
	"MOONSHOT_SEARCH_API_KEY",
	"PARALLEL_API_KEY",
	"PERPLEXITY_API_KEY",
	"SEARXNG_ENDPOINT",
	"SYNTHETIC_API_KEY",
	"TAVILY_API_KEY",
	"TINYFISH_API_KEY",
	"XAI_API_KEY",
] as const;

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalOmpProfile = process.env.OMP_PROFILE;
const originalPiProfile = process.env.PI_PROFILE;

let tempAgentDir: TempDir | undefined;
let originalEnv: Partial<Record<(typeof WEB_SEARCH_ENV_KEYS)[number], string | undefined>> = {};
let originalExitCode: typeof process.exitCode;

function responseUrl(input: string | Request | URL): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	return input.url;
}

function restoreEnv(key: string, value: string | undefined): void {
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}

function makeFetchMock(): typeof fetch {
	return Object.assign(
		async (input: string | Request | URL, _init?: RequestInit): Promise<Response> => {
			const url = responseUrl(input);
			if (url === "https://html.duckduckgo.com/html/") {
				return new Response(
					'<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fddg.example">DDG result</a><a class="result__snippet">duck</a></div><div class="nav-link"></div>',
					{ status: 200, headers: { "Content-Type": "text/html" } },
				);
			}
			return new Response(`unexpected URL: ${url}`, { status: 500 });
		},
		{ preconnect: fetch.preconnect },
	);
}

beforeEach(async () => {
	originalEnv = Object.fromEntries(WEB_SEARCH_ENV_KEYS.map(key => [key, process.env[key]]));
	for (const key of WEB_SEARCH_ENV_KEYS) delete process.env[key];
	originalExitCode = process.exitCode;
	process.exitCode = undefined;

	resetSettingsForTest();
	setPreferredSearchProvider("auto");
	setExcludedSearchProviders([]);
	tempAgentDir = TempDir.createSync("@omp-search-cli-");
	setAgentDir(tempAgentDir.path());
	await Settings.init({
		inMemory: true,
		cwd: tempAgentDir.path(),
		overrides: {
			"providers.webSearch": "tavily",
			"providers.webSearchExclude": ["jina"],
		},
	});
});

afterEach(async () => {
	vi.restoreAllMocks();
	resetSettingsForTest();
	setPreferredSearchProvider("auto");
	setExcludedSearchProviders([]);
	process.exitCode = originalExitCode;
	for (const key of WEB_SEARCH_ENV_KEYS) {
		restoreEnv(key, originalEnv[key]);
	}
	restoreEnv("PI_CODING_AGENT_DIR", originalAgentDir);
	restoreEnv("OMP_PROFILE", originalOmpProfile);
	restoreEnv("PI_PROFILE", originalPiProfile);
	__resetDirsFromEnvForTests();
	if (tempAgentDir) {
		await tempAgentDir.remove();
		tempAgentDir = undefined;
	}
});

describe("runSearchCommand provider settings", () => {
	it("ignores legacy broad-provider settings and uses a selected Pi provider", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(makeFetchMock());

		let stdout = "";
		vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
			stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
			return true;
		});

		await runSearchCommand({ query: "provider selection smoke test", limit: 1, expanded: false });

		const plain = stripVTControlCharacters(stdout);
		expect(plain).toContain("Provider: DuckDuckGo");
		expect(plain).not.toContain("Tavily");
		expect(plain).not.toContain("Jina");
	});

	it("keeps explicit auto inside Pi's selected provider set", async () => {
		const currentTempDir = tempAgentDir;
		if (!currentTempDir) throw new Error("tempAgentDir missing");
		resetSettingsForTest();
		setPreferredSearchProvider("auto");
		setExcludedSearchProviders([]);
		await Settings.init({
			inMemory: true,
			cwd: currentTempDir.path(),
			overrides: { "providers.webSearch": "tavily", "providers.webSearchExclude": ["jina"] },
		});

		vi.spyOn(globalThis, "fetch").mockImplementation(makeFetchMock());

		let stdout = "";
		vi.spyOn(process.stdout, "write").mockImplementation(chunk => {
			stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
			return true;
		});

		await runSearchCommand({ query: "explicit auto chain", provider: "auto", limit: 1, expanded: false });

		const plain = stripVTControlCharacters(stdout);
		expect(plain).toContain("Provider: DuckDuckGo");
		expect(plain).not.toContain("Tavily");
		expect(plain).not.toContain("Jina");
	});
});
