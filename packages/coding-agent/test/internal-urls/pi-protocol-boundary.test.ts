import { describe, expect, it } from "bun:test";
import { InternalUrlRouter } from "@oh-my-pi/pi-coding-agent/internal-urls";
import {
	type InternalResource,
	type InternalUrl,
	PI_INTERNAL_PROTOCOL_SCHEMES,
	type ProtocolHandler,
} from "@oh-my-pi/pi-coding-agent/internal-urls/types";

describe("Pi internal resource boundary", () => {
	it("registers exactly the selected protocol handlers", () => {
		const router = new InternalUrlRouter();
		const selected = new Set<string>(PI_INTERNAL_PROTOCOL_SCHEMES);

		for (const scheme of selected) {
			expect(router.getHandler(scheme)?.scheme).toBe(scheme);
			expect(router.canHandle(`${scheme}://resource`)).toBe(true);
		}

		for (const disabled of ["issue", "pr", "rule", "omp", "conflict", "db"]) {
			expect(selected.has(disabled)).toBe(false);
			expect(router.getHandler(disabled)).toBeUndefined();
			expect(router.canHandle(`${disabled}://resource`)).toBe(false);
		}
	});

	it("rejects disabled and arbitrary schemes without invoking a host handler", async () => {
		let resolutions = 0;
		const handler: ProtocolHandler = {
			scheme: "db",
			immutable: true,
			async resolve(url: InternalUrl): Promise<InternalResource> {
				resolutions++;
				return { url: url.href, content: "row", contentType: "text/plain" };
			},
		};
		const router = new InternalUrlRouter();

		expect(router.register(handler)).toBe(false);
		await expect(router.resolve("db://row/1")).rejects.toThrow("Unknown protocol: db://");
		await expect(router.resolve("issue://owner/repo/1")).rejects.toThrow("Unknown protocol: issue://");
		await expect(router.resolve("rule://legacy")).rejects.toThrow("Unknown protocol: rule://");
		expect(resolutions).toBe(0);
	});

	it("does not let runtime callers remove selected handlers", () => {
		const router = new InternalUrlRouter();

		expect(router.unregister("ssh")).toBe(false);
		expect(router.canHandle("ssh://host/etc/hosts")).toBe(true);
	});
});
