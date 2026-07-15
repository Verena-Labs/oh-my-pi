import { describe, expect, it } from "bun:test";
import { gzipSync } from "node:zlib";
import { decodeDocsIndex } from "@oh-my-pi/pi-coding-agent/internal-urls/docs-index";
import { PI_DOC_FILENAMES } from "@oh-my-pi/pi-coding-agent/internal-urls/pi-docs-manifest";
import { buildDocsIndexPayload } from "../../scripts/generate-docs-index";

function embed(files: readonly string[], bodies: readonly string[]): string {
	return `${JSON.stringify(files)}\n${Buffer.from(gzipSync(Buffer.from(JSON.stringify(bodies)))).toString("base64")}`;
}

const files = ["agent.md", "tools/read.md"];
const bodies = ["agent body", "read body"];
const embedPayload = embed(files, bodies);

// The embed path only runs in compiled binaries / the npm bundle; dev tests
// otherwise exercise the disk fallback (empty placeholder), so a regression in
// the two-line `<filenames>\n<gzip bodies>` parsing would ship broken `pi://`
// docs undetected. These cover the populated-embed decode directly.
describe("decodeDocsIndex (embedded docs path)", () => {
	it("lists filenames from the first line without inflating the blob", () => {
		// A deliberately corrupt blob: filenames must resolve anyway, proving the
		// listing path never decodes the gzip body.
		const index = decodeDocsIndex(`${JSON.stringify(files)}\n@@@not-a-valid-gzip-blob@@@`);
		expect(index?.filenames).toEqual(files);
	});

	it("resolves bodies by index-aligned path, lazily, on first read", async () => {
		const index = decodeDocsIndex(embedPayload);
		expect(index).not.toBeNull();
		expect(await index?.getBody("agent.md")).toBe("agent body");
		expect(await index?.getBody("tools/read.md")).toBe("read body");
		expect(await index?.getBody("missing.md")).toBeUndefined();
	});

	it("returns null when there is no newline separator (empty placeholder)", () => {
		expect(decodeDocsIndex("")).toBeNull();
	});
});

describe("public Pi docs manifest", () => {
	it("builds only the explicit Pi-safe documentation set", async () => {
		const built = await buildDocsIndexPayload();
		expect(built.files).toEqual([...PI_DOC_FILENAMES].sort());
		expect(built.files).toContain("pi.md");
		for (const disabled of ["collab.md", "approval-mode.md", "config-usage.md", "environment-variables.md"]) {
			expect(built.files).not.toContain(disabled);
		}
	});

	it("does not embed upstream branding, state roots, or disabled-service instructions", async () => {
		const built = await buildDocsIndexPayload();
		const publicDocs = built.bodies.join("\n");
		expect(publicDocs).not.toMatch(/\bOMP\b|Oh My Pi|\.omp(?:\/|\b)|omp:\/\/|omp\.sh/i);
		expect(publicDocs).not.toMatch(/\bACP\b|\/collab\b|\/join\b|\/share\b/i);
	});

	it("describes only selected tools and manual task isolation", async () => {
		const built = await buildDocsIndexPayload();
		const docs = new Map(built.files.map((file, index) => [file, built.bodies[index] ?? ""]));
		const taskDoc = docs.get("tools/task.md") ?? "";
		const discoveryDoc = docs.get("tools/search_tool_bm25.md") ?? "";

		expect(taskDoc).not.toMatch(/\beval\b/i);
		expect(taskDoc).toContain("Neither mode applies or merges changes into the parent checkout automatically.");
		expect(taskDoc).not.toMatch(/cherry-pick into parent|patch apply/i);
		expect(discoveryDoc).not.toMatch(/\beval\b/i);
		expect(discoveryDoc).toContain("`read`, `bash`, `launch`, `edit`, `write`, and `glob`");
	});
});
