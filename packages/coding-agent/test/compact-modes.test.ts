import { describe, expect, it } from "bun:test";
import { findCompactMode, parseCompactArgs } from "../src/session/compact-modes";

describe("Pi compact mode registry", () => {
	it("does not expose OMP's soft, remote, or snapcompact modes", () => {
		for (const mode of ["soft", "remote", "snapcompact", "SOFT", "  Remote "]) {
			expect(findCompactMode(mode)).toBeUndefined();
		}
	});
});

describe("parseCompactArgs", () => {
	it("returns no mode and no instructions for empty args", () => {
		expect(parseCompactArgs("")).toEqual({});
		expect(parseCompactArgs("   ")).toEqual({});
	});

	it("treats every non-empty argument as baseline focus instructions", () => {
		expect(parseCompactArgs("summarize the auth flow")).toEqual({ instructions: "summarize the auth flow" });
		expect(parseCompactArgs("everything")).toEqual({ instructions: "everything" });
		expect(parseCompactArgs("soft focus on the parser bug")).toEqual({
			instructions: "soft focus on the parser bug",
		});
		expect(parseCompactArgs("remote")).toEqual({ instructions: "remote" });
		expect(parseCompactArgs("snapcompact keep the diffs")).toEqual({
			instructions: "snapcompact keep the diffs",
		});
	});
});
