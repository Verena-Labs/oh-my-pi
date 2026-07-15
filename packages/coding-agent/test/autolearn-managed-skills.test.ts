import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { parseFrontmatter, removeWithRetries } from "@oh-my-pi/pi-utils";
import { getAgentDir, setAgentDir } from "@oh-my-pi/pi-utils/dirs";
import {
	deleteManagedSkill,
	getManagedSkillsDir,
	piAllowsManagedSkillMutation,
	sanitizeSkillName,
	toSkillFrontmatter,
	writeManagedSkill,
} from "../src/autolearn/managed-skills";

describe("Pi managed-skill policy", () => {
	let tempHome: string;
	let originalAgentDir: string;

	beforeEach(async () => {
		originalAgentDir = getAgentDir();
		tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "pi-managed-skills-policy-"));
		spyOn(os, "homedir").mockReturnValue(tempHome);
		setAgentDir(path.join(tempHome, ".pi", "agent"));
	});

	afterEach(async () => {
		spyOn(os, "homedir").mockRestore();
		setAgentDir(originalAgentDir);
		await removeWithRetries(tempHome);
	});

	it("keeps the vendored validation and serialization helpers intact", () => {
		expect(sanitizeSkillName("  Demo-Skill ")).toBe("demo-skill");
		expect(() => sanitizeSkillName("../escape")).toThrow();
		const { frontmatter } = parseFrontmatter(`${toSkillFrontmatter("demo", "A\n description")}\nbody`, {
			source: "test",
		});
		expect(frontmatter).toMatchObject({ name: "demo", description: "A description" });
	});

	it("rejects direct create, update, and delete before filesystem access", async () => {
		expect(piAllowsManagedSkillMutation()).toBe(false);
		for (const action of ["create", "update"] as const) {
			await expect(
				writeManagedSkill({ action, name: "blocked", description: "Blocked.", body: "# Blocked" }),
			).rejects.toThrow("unavailable in Pi");
		}
		await expect(deleteManagedSkill("blocked")).rejects.toThrow("unavailable in Pi");
		expect(await fs.readdir(getManagedSkillsDir()).catch(() => [])).toEqual([]);
	});

	it("does not even resolve unsafe direct-call names before the policy rejection", async () => {
		await expect(
			writeManagedSkill({ action: "create", name: "../authored", description: "Blocked.", body: "# Blocked" }),
		).rejects.toThrow("unavailable in Pi");
		expect(await fs.readdir(path.dirname(getManagedSkillsDir())).catch(() => [])).toEqual([]);
	});
});
