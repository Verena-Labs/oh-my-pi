import { describe, expect, test } from "bun:test";
import {
	getThemeByName,
	type SymbolPreset,
	Theme,
	type ThemeBg,
	type ThemeColor,
} from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

function themeWithPreset(preset: SymbolPreset): Theme {
	const foreground = {} as Record<ThemeColor, string | number>;
	const background = { statusLineBg: "#000000" } as Record<ThemeBg, string | number>;
	return new Theme(foreground, background, "truecolor", preset, {});
}

describe("Ultra thinking symbol", () => {
	test("has a distinct public default in every symbol preset", () => {
		expect(themeWithPreset("unicode").thinking.ultra).toBe("∞ ultra");
		expect(themeWithPreset("nerd").thinking.ultra).toBe("\uf0c0 ult");
		expect(themeWithPreset("ascii").thinking.ultra).toBe("[ult]");
	});

	test("uses the dedicated Poimandres override in both variants", async () => {
		const [dark, light] = await Promise.all([getThemeByName("dark-poimandres"), getThemeByName("light-poimandres")]);

		expect(dark?.thinking.ultra).toBe("∞");
		expect(light?.thinking.ultra).toBe("∞");
	});
});
