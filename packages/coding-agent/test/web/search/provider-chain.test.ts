import { afterEach, describe, expect, it } from "bun:test";
import type { AuthStorage } from "@oh-my-pi/pi-ai";
import { SelectorController } from "@oh-my-pi/pi-coding-agent/modes/controllers/selector-controller";
import {
	resolveProviderChain,
	setExcludedSearchProviders,
	setPreferredSearchProvider,
} from "@oh-my-pi/pi-coding-agent/web/search/provider";
import { SEARCH_PROVIDER_ORDER } from "@oh-my-pi/pi-coding-agent/web/search/types";

const authStorage = { hasOAuth: () => false } as unknown as AuthStorage;

afterEach(() => {
	setPreferredSearchProvider("auto");
	setExcludedSearchProviders([]);
});

describe("resolveProviderChain", () => {
	it("contains only Pi's selected providers", () => {
		expect(SEARCH_PROVIDER_ORDER).toEqual(["codex", "duckduckgo"]);
	});

	it("omits excluded providers from the selected chain", async () => {
		setExcludedSearchProviders(["codex"]);

		const providers = await resolveProviderChain(authStorage, "auto");

		expect(providers.map(provider => provider.id)).toEqual(["duckduckgo"]);
	});

	it("does not fall back from an unavailable explicit provider unless enabled", async () => {
		expect(await resolveProviderChain(authStorage, "codex")).toEqual([]);

		const providers = await resolveProviderChain(authStorage, "codex", true);
		expect(providers.map(provider => provider.id)).toEqual(["duckduckgo"]);
	});

	it("applies live settings edits to the exclusion chain", async () => {
		const controller = new SelectorController({} as unknown as ConstructorParameters<typeof SelectorController>[0]);

		controller.handleSettingChange("providers.webSearchExclude", SEARCH_PROVIDER_ORDER);

		const providers = await resolveProviderChain(authStorage, "auto");

		expect(providers).toEqual([]);
	});
});
