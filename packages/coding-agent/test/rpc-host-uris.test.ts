import { afterEach, describe, expect, it } from "bun:test";
import { InternalUrlRouter } from "@oh-my-pi/pi-coding-agent/internal-urls";
import { PI_HOST_URI_SCHEME_REGISTRATION_ERROR, RpcHostUriBridge } from "@oh-my-pi/pi-coding-agent/modes/rpc/host-uris";
import type { RpcHostUriCancelRequest, RpcHostUriRequest } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-types";

function recordOutput(): {
	frames: Array<RpcHostUriRequest | RpcHostUriCancelRequest>;
	push: (frame: RpcHostUriRequest | RpcHostUriCancelRequest) => void;
} {
	const frames: Array<RpcHostUriRequest | RpcHostUriCancelRequest> = [];
	return { frames, push: frame => frames.push(frame) };
}

afterEach(() => {
	InternalUrlRouter.resetForTests();
});

describe("Pi RPC host URI boundary", () => {
	it("keeps arbitrary host-defined schemes unknown and inert", async () => {
		const out = recordOutput();
		const router = InternalUrlRouter.instance();
		const bridge = new RpcHostUriBridge(out.push, router);

		expect(() => bridge.setSchemes([{ scheme: "db", description: "rows", writable: true }])).toThrow(
			PI_HOST_URI_SCHEME_REGISTRATION_ERROR,
		);

		expect(bridge.getSchemes()).toEqual([]);
		expect(router.canHandle("db://users/42")).toBe(false);
		expect(router.getHandler("db")).toBeUndefined();
		await expect(router.resolve("db://users/42")).rejects.toThrow("Unknown protocol: db://");
		expect(out.frames).toEqual([]);
	});

	it("cannot replace or unregister a selected Pi protocol", async () => {
		const out = recordOutput();
		const router = InternalUrlRouter.instance();
		const piHandler = router.getHandler("pi");
		const bridge = new RpcHostUriBridge(out.push, router);

		expect(() => bridge.setSchemes([{ scheme: "pi", writable: true }])).toThrow(
			PI_HOST_URI_SCHEME_REGISTRATION_ERROR,
		);
		expect(bridge.getSchemes()).toEqual([]);
		expect(router.getHandler("pi")).toBe(piHandler);

		const resource = await router.resolve("pi://pi.md");
		expect(resource.content).toContain("# Pi");
		expect(out.frames).toEqual([]);

		bridge.clear("test cleanup");
		expect(router.canHandle("pi://pi.md")).toBe(true);
	});
});
