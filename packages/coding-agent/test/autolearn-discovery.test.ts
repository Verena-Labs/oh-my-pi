import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import "@oh-my-pi/pi-coding-agent/discovery";
import { loadSkills } from "@oh-my-pi/pi-coding-agent/extensibility/skills";
import { removeWithRetries } from "@oh-my-pi/pi-utils";
import { getAgentDir, setAgentDir } from "@oh-my-pi/pi-utils/dirs";
import { getManagedSkillsDir } from "../src/autolearn/managed-skills";

async function writeSkill(dir: string, name: string, description: string): Promise<void> {
	const file = path.join(dir, name, "SKILL.md");
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, ["---", `description: ${description}`, "---", "", `# ${name}`].join("\n"));
}

describe("managed-skills discovery", () => {
	let tempHome: string;
	let tempCwd: string;
	let managedDir: string;
	let authoredDir: string;

	let originalAgentDir: string;
	beforeEach(async () => {
		originalAgentDir = getAgentDir();
		tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "omp-managed-disco-home-"));
		// cwd MUST live under the fake home so loadSkills' ancestor walk is bounded
		// and cannot pick up ambient /tmp/.omp or /.omp fixtures (full-suite-safe).
		tempCwd = path.join(tempHome, "work");
		await fs.mkdir(tempCwd, { recursive: true });
		spyOn(os, "homedir").mockReturnValue(tempHome);
		setAgentDir(path.join(tempHome, ".pi", "agent"));
		managedDir = getManagedSkillsDir();
		// Authored user skills live in the sibling `skills/` dir under .../agent.
		authoredDir = path.join(path.dirname(managedDir), "skills");
	});

	afterEach(async () => {
		spyOn(os, "homedir").mockRestore();
		setAgentDir(originalAgentDir);
		await removeWithRetries(tempHome);
	});

	it("does not discover a pre-existing managed skill", async () => {
		await writeSkill(managedDir, "managed-only", "A legacy managed skill.");
		const { skills, warnings } = await loadSkills({ cwd: tempCwd });
		expect(skills.some(skill => skill.name === "managed-only")).toBe(false);
		expect(skills.some(skill => skill.source === "omp-managed:user")).toBe(false);
		expect(warnings.some(warning => warning.message.includes("managed-skills"))).toBe(false);
	});

	it("preserves ordinary authored Pi skills while ignoring the managed directory", async () => {
		await writeSkill(authoredDir, "authored", "An authored Pi skill.");
		await writeSkill(managedDir, "managed-only", "A legacy managed skill.");
		const { skills } = await loadSkills({ cwd: tempCwd });
		expect(skills.find(skill => skill.name === "authored")?.source).toBe("native:user");
		expect(skills.some(skill => skill.name === "managed-only")).toBe(false);
	});

	it("never lets a managed file participate in an authored name collision", async () => {
		await writeSkill(authoredDir, "same-name", "The authored version.");
		await writeSkill(managedDir, "same-name", "The dormant managed version.");
		const { skills } = await loadSkills({ cwd: tempCwd });
		const matches = skills.filter(skill => skill.name === "same-name");
		expect(matches).toHaveLength(1);
		expect(matches[0]?.source).toBe("native:user");
	});
});
