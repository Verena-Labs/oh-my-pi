import packageJson from "../../package.json" with { type: "json" };

export function getOpenRouterHeaders(): Record<string, string> {
	return {
		"User-Agent": `Pi/${packageJson.version}`,
		"X-OpenRouter-Title": "Pi",
		"X-OpenRouter-Categories": "cli-agent",
		"X-OpenRouter-Cache": "true",
		"X-OpenRouter-Cache-TTL": "3600",
	};
}
