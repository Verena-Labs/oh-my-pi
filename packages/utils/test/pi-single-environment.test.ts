import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { APP_NAME, DISTRIBUTION_VERSION, OMP_BASE_SNAPSHOT, VERSION } from "../src/dirs";

const tempDirs: string[] = [];

afterEach(() => {
	for (const tempDir of tempDirs.splice(0)) fs.rmSync(tempDir, { recursive: true, force: true });
});

test("public build identity records the downstream product and immutable OMP base", () => {
	expect(APP_NAME).toBe("pi");
	expect(OMP_BASE_SNAPSHOT).toBe("3047c27c33");
	expect(DISTRIBUTION_VERSION).toBe(`${VERSION}+pi.base.${OMP_BASE_SNAPSHOT}`);
});

test("direct imports stay pinned to one Pi state root", async () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-single-environment-"));
	tempDirs.push(home);
	const dirsUrl = new URL("../src/dirs.ts", import.meta.url).href;
	const source = `
		import {
			getActiveProfile,
			getAgentDir,
			getConfigDirName,
			getConfigRootDir,
			setAgentDir,
			setProfile,
		} from ${JSON.stringify(dirsUrl)};
		let profileError;
		let agentDirError;
		try { setProfile("work"); } catch (error) { profileError = String(error); }
		try { setAgentDir("/private/tmp/alternate-pi-agent"); } catch (error) { agentDirError = String(error); }
		console.log(JSON.stringify({
			activeProfile: getActiveProfile() ?? null,
			agentDir: getAgentDir(),
			configDirName: getConfigDirName(),
			configRoot: getConfigRootDir(),
			profileError,
			agentDirError,
		}));
	`;
	const proc = Bun.spawn([process.execPath, "-e", source], {
		env: {
			...process.env,
			NODE_ENV: "production",
			HOME: home,
			OMP_PROFILE: "work",
			PI_PROFILE: "other",
			PI_CONFIG_DIR: ".alternate-pi",
			PI_CODING_AGENT_DIR: path.join(home, ".alternate-pi", "agent"),
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	expect(exitCode, stderr).toBe(0);
	expect(JSON.parse(stdout)).toEqual({
		activeProfile: null,
		agentDir: path.join(home, ".pi", "agent"),
		configDirName: ".pi",
		configRoot: path.join(home, ".pi"),
		profileError: "Error: Named profiles are unavailable in Pi.",
		agentDirError: `Error: Pi uses one agent directory at ${path.join(home, ".pi", "agent")}; alternate agent directories are unavailable.`,
	});
});
