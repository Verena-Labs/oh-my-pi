import { afterEach, describe, expect, it, vi } from "bun:test";
import { applyProviderGlobalsFromSettings } from "@oh-my-pi/pi-coding-agent/config/provider-globals";
import * as imageGen from "@oh-my-pi/pi-coding-agent/tools/image-gen";
import * as webSearch from "@oh-my-pi/pi-coding-agent/web/search";

describe("applyProviderGlobalsFromSettings", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("reapplies only selected Pi web providers and valid image providers", () => {
		const excludeSpy = vi.spyOn(webSearch, "setExcludedSearchProviders").mockImplementation(() => {});
		const webSpy = vi.spyOn(webSearch, "setPreferredSearchProvider").mockImplementation(() => {});
		const imageSpy = vi.spyOn(imageGen, "setPreferredImageProvider").mockImplementation(() => {});

		applyProviderGlobalsFromSettings({
			get(path: "providers.webSearchExclude" | "providers.webSearch" | "providers.image"): unknown {
				const values: Record<string, unknown> = {
					"providers.webSearchExclude": ["codex", "not-a-provider", "duckduckgo"],
					"providers.webSearch": "codex",
					"providers.image": "xai",
				};
				return values[path];
			},
		});

		expect(excludeSpy).toHaveBeenCalledWith(["codex", "duckduckgo"]);
		expect(webSpy).toHaveBeenCalledWith("codex");
		expect(imageSpy).toHaveBeenCalledWith("xai");
	});
});
