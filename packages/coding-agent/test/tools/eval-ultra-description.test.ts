import { describe, expect, it } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { EvalTool } from "../../src/tools/eval";

describe("Eval tool in Ultra", () => {
	it("does not advertise the ordinary agent helper", () => {
		const session = {
			cwd: process.cwd(),
			hasUI: false,
			getSessionFile: () => null,
			getSessionSpawns: () => "*",
			isUltraOrchestrationActive: () => true,
			settings: Settings.isolated(),
		} as unknown as ToolSession;

		expect(new EvalTool(session).description).not.toContain("agent(prompt");
	});
});
