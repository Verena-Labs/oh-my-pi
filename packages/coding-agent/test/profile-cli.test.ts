import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import { APP_NAME, DISTRIBUTION_VERSION, getActiveProfile, setProfile } from "@oh-my-pi/pi-utils/dirs";
import { runCli } from "../src/cli";

const ENV_KEYS = ["OMP_PROFILE", "PI_PROFILE", "PI_CONFIG_DIR", "PI_CODING_AGENT_DIR"] as const;
type EnvKey = (typeof ENV_KEYS)[number];

describe("Pi single-home CLI boundary", () => {
	let originalEnv: Record<EnvKey, string | undefined>;

	beforeEach(() => {
		originalEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]])) as Record<
			EnvKey,
			string | undefined
		>;
		setProfile(undefined);
		for (const key of ENV_KEYS) delete process.env[key];
		process.exitCode = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		setProfile(undefined);
		for (const key of ENV_KEYS) {
			const value = originalEnv[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		process.exitCode = 0;
	});

	it("reports the downstream Pi identity from the default profile", async () => {
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await runCli(["--version"]);

		expect(process.exitCode).toBe(0);
		expect(outSpy.mock.calls.map(call => String(call[0] ?? "")).join("\n")).toContain(
			`${APP_NAME}/${DISTRIBUTION_VERSION}`,
		);
		expect(APP_NAME).toBe("pi");
		expect(getActiveProfile()).toBeUndefined();
	});

	it("does not advertise the dormant profile machinery in public help", async () => {
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await runCli(["--help"]);

		const output = outSpy.mock.calls.map(call => String(call[0] ?? "")).join("\n");
		expect(process.exitCode).toBe(0);
		expect(output).toContain(`USAGE\n  $ ${APP_NAME}`);
		expect(output).not.toContain("--profile");
		expect(output).not.toContain("--alias");
		expect(output).not.toContain("Oh My Pi");
	});

	it("rejects profile and alias flags before command dispatch", async () => {
		const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

		await runCli(["--profile", "work", "--alias", "pi-work", "--version"]);

		expect(process.exitCode).toBe(1);
		expect(errSpy.mock.calls.map(call => String(call[0] ?? "")).join("\n")).toContain(
			"Named profiles and profile aliases are not available in Pi.",
		);
		expect(outSpy).not.toHaveBeenCalled();
		expect(getActiveProfile()).toBeUndefined();
	});

	it("rejects profile environment selection before command dispatch", async () => {
		const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		process.env.OMP_PROFILE = "work";

		await runCli(["--version"]);

		expect(process.exitCode).toBe(1);
		expect(errSpy.mock.calls.map(call => String(call[0] ?? "")).join("\n")).toContain(
			"Named profiles and profile aliases are not available in Pi.",
		);
		expect(outSpy).not.toHaveBeenCalled();
	});

	it("allows only the default config and agent paths used by the isolation harness", async () => {
		const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		process.env.PI_CONFIG_DIR = ".pi";
		process.env.PI_CODING_AGENT_DIR = path.join(os.homedir(), ".pi", "agent");

		await runCli(["--version"]);

		expect(process.exitCode).toBe(0);
		expect(outSpy).toHaveBeenCalled();
	});

	it("rejects alternate permanent state roots", async () => {
		const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		process.env.PI_CONFIG_DIR = ".pi-work";

		await runCli(["--version"]);

		expect(process.exitCode).toBe(1);
		expect(errSpy.mock.calls.map(call => String(call[0] ?? "")).join("\n")).toContain(
			"Pi uses one state root at ~/.pi",
		);
	});
});
