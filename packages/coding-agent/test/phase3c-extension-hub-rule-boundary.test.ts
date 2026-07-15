import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	getAllCapabilitiesInfo,
	getAllProvidersInfo,
	getCapability,
	getCapabilityInfo,
	listCapabilities,
	loadCapability,
} from "@oh-my-pi/pi-coding-agent/discovery";
import { loadAllExtensions } from "@oh-my-pi/pi-coding-agent/modes/components/extensions/state-manager";

test("the retained extension hub does not discover or advertise disabled rules", async () => {
	const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pi-extension-hub-rules-"));
	try {
		const rulesDir = path.join(cwd, ".pi", "rules");
		await fs.mkdir(rulesDir, { recursive: true });
		await Bun.write(
			path.join(rulesDir, "disabled-rule.md"),
			"---\ndescription: must stay hidden\nalwaysApply: true\n---\nDo not publish this rule.",
		);

		const extensions = await loadAllExtensions(cwd);
		expect(extensions.some(extension => extension.kind === "rule")).toBe(false);
	} finally {
		await fs.rm(cwd, { recursive: true, force: true });
	}
});

test("generic capability discovery cannot enumerate or load disabled rules", async () => {
	expect(listCapabilities()).not.toContain("rules");
	expect(getCapability("rules")).toBeUndefined();
	expect(getCapabilityInfo("rules")).toBeUndefined();
	expect(getAllCapabilitiesInfo().some(capability => capability.id === "rules")).toBe(false);
	expect(getAllProvidersInfo().some(provider => provider.capabilities.includes("rules"))).toBe(false);
	await expect(loadCapability("rules", { cwd: process.cwd() })).rejects.toThrow('Unknown capability: "rules"');
});
