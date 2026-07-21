import { describe, expect, it } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import {
	getPiLockedSetting,
	getUi,
	hasUi,
	isPiLockedSetting,
	PI_DISABLED_SETTING_FAMILIES,
	SETTINGS_SCHEMA,
	type SettingPath,
} from "@oh-my-pi/pi-coding-agent/config/settings-schema";

describe("Pi disabled setting policy", () => {
	it("locks and hides every disabled family from the shared schema boundary", () => {
		const familyPaths = (Object.keys(SETTINGS_SCHEMA) as SettingPath[]).filter(path =>
			PI_DISABLED_SETTING_FAMILIES.some(family => path.startsWith(`${family}.`)),
		);
		expect(familyPaths.length).toBeGreaterThan(40);
		for (const path of familyPaths) {
			expect(isPiLockedSetting(path), path).toBe(true);
			expect(getPiLockedSetting(path).locked, path).toBe(true);
			expect(hasUi(path), path).toBe(false);
			expect(getUi(path), path).toBeUndefined();
		}

		for (const path of [
			"commands.enableClaudeUser",
			"commands.enableClaudeProject",
			"commands.enableOpencodeUser",
			"commands.enableOpencodeProject",
			"providers.tts",
		] satisfies SettingPath[]) {
			expect(isPiLockedSetting(path), path).toBe(true);
			expect(getUi(path), path).toBeUndefined();
		}
	});

	it("forces disabled families inert and rejects direct Settings mutation", () => {
		const settings = Settings.isolated({
			"auth.broker.url": "https://broker.invalid",
			"commands.enableClaudeUser": true,
			"eval.js": true,
			"github.enabled": true,
			"ttsr.builtinRules": true,
		});

		expect(settings.get("auth.broker.url")).toBeUndefined();
		expect(settings.get("commands.enableClaudeUser")).toBe(false);
		expect(settings.get("eval.js")).toBe(false);
		expect(settings.get("github.enabled")).toBe(false);
		expect(settings.get("ttsr.builtinRules")).toBe(false);
		expect(() => settings.set("stt.modelName", "parakeet")).toThrow('Setting "stt.modelName" is unavailable in Pi.');
	});

	it("leaves selected settings visible and configurable", () => {
		for (const path of [
			"memory.backend",
			"tools.approvalMode",
			"task.isolation.mode",
			"providers.webSearch",
		] satisfies SettingPath[]) {
			expect(isPiLockedSetting(path), path).toBe(false);
			expect(hasUi(path), path).toBe(true);
			expect(getUi(path), path).toBeDefined();
		}
	});
});
