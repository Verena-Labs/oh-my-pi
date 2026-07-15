import { describe, expect, test } from "bun:test";
import { startAuthBroker } from "../src/auth-broker";
import { startAuthGateway } from "../src/auth-gateway";

const BLOCKED_REMOTE_AUTH_SUBPATHS = [
	"@oh-my-pi/pi-ai/auth-broker",
	"@oh-my-pi/pi-ai/auth-broker.js",
	"@oh-my-pi/pi-ai/auth-broker/discover",
	"@oh-my-pi/pi-ai/auth-broker/types",
	"@oh-my-pi/pi-ai/auth-broker/wire-schemas.js",
	"@oh-my-pi/pi-ai/auth-gateway",
	"@oh-my-pi/pi-ai/auth-gateway.js",
	"@oh-my-pi/pi-ai/auth-gateway/http",
	"@oh-my-pi/pi-ai/auth-gateway/types.js",
] as const;

interface ImportProbeResult {
	readonly code?: string;
	readonly message?: string;
	readonly status: "error" | "loaded";
}

async function probeImports(specifiers: readonly string[]): Promise<Record<string, ImportProbeResult>> {
	const source = `
		const specifiers = ${JSON.stringify(specifiers)};
		const results = {};
		for (const specifier of specifiers) {
			try {
				await import(specifier);
				results[specifier] = { status: "loaded" };
			} catch (error) {
				results[specifier] = {
					status: "error",
					code: error && typeof error === "object" && "code" in error ? String(error.code) : undefined,
					message: error instanceof Error ? error.message : String(error),
				};
			}
		}
		console.log(JSON.stringify(results));
	`;
	const proc = Bun.spawn([process.execPath, "-e", source], {
		cwd: import.meta.dir,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, NO_COLOR: "1" },
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	expect(exitCode, stderr).toBe(0);
	return JSON.parse(stdout) as Record<string, ImportProbeResult>;
}

describe("Pi remote credential service boundary", () => {
	test("broker and gateway public package paths are unreachable", async () => {
		const results = await probeImports(BLOCKED_REMOTE_AUTH_SUBPATHS);
		for (const specifier of BLOCKED_REMOTE_AUTH_SUBPATHS) {
			const result = results[specifier];
			expect(result?.status, specifier).toBe("error");
			expect(result?.code, specifier).toBe("ERR_MODULE_NOT_FOUND");
			expect(result?.message, specifier).toContain(specifier);
		}
	});

	test("the retained AI root does not re-export broker or gateway APIs", async () => {
		const ai = await import("@oh-my-pi/pi-ai");
		for (const name of [
			"AuthBrokerClient",
			"RemoteAuthCredentialStore",
			"startAuthBroker",
			"startAuthGateway",
			"DEFAULT_AUTH_BROKER_BIND",
			"DEFAULT_AUTH_GATEWAY_BIND",
		]) {
			expect(name in ai, name).toBe(false);
		}
	});

	test("dormant internal servers fail before binding sockets or starting timers", () => {
		expect(() => (startAuthBroker as (options: object) => unknown)({})).toThrow("unavailable in Pi");
		expect(() => (startAuthGateway as (options: object) => unknown)({})).toThrow("unavailable in Pi");
	});
});
