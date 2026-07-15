import { describe, expect, it } from "bun:test";
import { InternalUrlRouter } from "@oh-my-pi/pi-coding-agent/internal-urls";

describe("PiProtocolHandler", () => {
	it("registers the Pi documentation scheme without the legacy OMP alias", () => {
		const router = InternalUrlRouter.instance();
		expect(router.canHandle("pi://docs")).toBe(true);
		expect(router.canHandle("omp://docs")).toBe(false);
	});

	it("treats pi://docs as the documentation root", async () => {
		const resource = await InternalUrlRouter.instance().resolve("pi://docs");

		expect(resource.content).toContain("# Documentation");
		expect(resource.content).toContain("pi.md");
		expect(resource.content).not.toContain("collab.md");
		expect(resource.content).not.toContain("config-usage.md");
	});

	it("resolves docs-prefixed documentation paths", async () => {
		const router = InternalUrlRouter.instance();
		const direct = await router.resolve("pi://pi.md");
		const prefixed = await router.resolve("pi://docs/pi.md");

		expect(prefixed.content).toBe(direct.content);
		expect(prefixed.content).toContain("# Pi");
	});

	it("treats disabled and legacy upstream docs as unavailable", async () => {
		const router = InternalUrlRouter.instance();
		for (const filename of ["collab.md", "approval-mode.md", "config-usage.md", "environment-variables.md"]) {
			await expect(router.resolve(`pi://${filename}`)).rejects.toThrow(`Documentation file not found: ${filename}`);
		}
	});
});
