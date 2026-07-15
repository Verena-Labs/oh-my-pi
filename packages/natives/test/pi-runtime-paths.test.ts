import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { resolveNativesDir } from "../native/loader-state.js";

describe("Pi native runtime paths", () => {
	test("uses Pi-owned home and XDG roots", () => {
		expect(resolveNativesDir({ home: "/home/pi", xdgPiExists: false })).toBe(path.join("/home/pi", ".pi", "natives"));
		expect(resolveNativesDir({ home: "/home/pi", xdgDataHome: "/xdg/data", xdgPiExists: true })).toBe(
			path.join("/xdg/data", "pi", "natives"),
		);
	});
});
