import { afterEach, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getCapability } from "@oh-my-pi/pi-coding-agent/capability";
import { clearCache } from "@oh-my-pi/pi-coding-agent/capability/fs";
// Importing discovery registers all public providers as a side effect.
import { loadCapability } from "@oh-my-pi/pi-coding-agent/discovery";
import { getConfigRootDir, removeSyncWithRetries, setAgentDir } from "@oh-my-pi/pi-utils";
import { type Rule, ruleCapability } from "../../src/capability/rule";

let tempDir: string;
let home: string;
let project: string;

const originalAgentDirEnv = process.env.PI_CODING_AGENT_DIR;
const fallbackAgentDir = path.join(getConfigRootDir(), "agent");

function writeFile(filePath: string, content: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content);
}

beforeEach(() => {
	clearCache();
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-rules-disabled-"));
	home = path.join(tempDir, "home");
	project = path.join(tempDir, "project");
	fs.mkdirSync(home, { recursive: true });
	fs.mkdirSync(path.join(project, ".git"), { recursive: true });
	setAgentDir(path.join(home, ".pi", "agent"));
});

afterEach(() => {
	clearCache();
	if (originalAgentDirEnv) {
		setAgentDir(originalAgentDirEnv);
	} else {
		setAgentDir(fallbackAgentDir);
		delete process.env.PI_CODING_AGENT_DIR;
	}
	removeSyncWithRetries(tempDir);
});

test("native discovery does not publish a rule provider", () => {
	const capability = getCapability(ruleCapability.id);
	expect(capability?.providers.some(provider => provider.id === "native")).toBe(false);
});

test("legacy user, project, and scoped rule files remain inert", async () => {
	writeFile(path.join(home, ".pi", "agent", "RULES.md"), "User rule must not be injected.\n");
	writeFile(path.join(project, ".pi", "RULES.md"), "Project rule must not be injected.\n");
	writeFile(path.join(project, ".pi", "rules", "scoped.md"), "Scoped rule must not be injected.\n");

	const result = await loadCapability<Rule>(ruleCapability.id, { cwd: project, providers: ["native"] });
	expect(result.items).toEqual([]);
});
