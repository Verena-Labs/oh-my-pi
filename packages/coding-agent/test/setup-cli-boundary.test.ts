import { afterEach, describe, expect, it, vi } from "bun:test";
import { parseSetupArgs, printSetupHelp, runSetupCommand } from "@oh-my-pi/pi-coding-agent/cli/setup-cli";
import { assertPiSetupPositionals, PI_SETUP_COMPONENTS } from "@oh-my-pi/pi-coding-agent/cli/setup-policy";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Pi setup command boundary", () => {
	it("rejects optional components at the public command parser", () => {
		expect(PI_SETUP_COMPONENTS).toEqual([]);
		expect(() => assertPiSetupPositionals(["python"])).toThrow(
			"Unknown setup component: python. Pi setup only runs interactive onboarding.",
		);
		expect(() => assertPiSetupPositionals(["speech"])).toThrow(
			"Unknown setup component: speech. Pi setup only runs interactive onboarding.",
		);
		expect(() => assertPiSetupPositionals([])).not.toThrow();
	});

	it("rejects legacy python and speech component routing", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
			throw new Error("process.exit");
		}) as typeof process.exit);

		expect(() => parseSetupArgs(["setup", "python"])).toThrow("process.exit");
		expect(() => parseSetupArgs(["setup", "speech"])).toThrow("process.exit");
		expect(exitSpy).toHaveBeenCalledTimes(2);

		await expect(runSetupCommand({ component: "python", flags: {} })).rejects.toThrow(
			"Optional component setup (python) is unavailable in Pi.",
		);
		await expect(runSetupCommand({ component: "speech", flags: {} })).rejects.toThrow(
			"Optional component setup (speech) is unavailable in Pi.",
		);
	});

	it("does not advertise dormant runtime or speech setup", () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		printSetupHelp();
		const help = Bun.stripANSI(String(logSpy.mock.calls.at(-1)?.[0] ?? ""));

		expect(help).toContain("pi setup");
		expect(help).not.toContain("python");
		expect(help).not.toContain("speech");
		expect(help).not.toContain("component");
	});
});
