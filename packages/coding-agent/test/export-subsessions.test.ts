import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { exportFromFile, type SessionData } from "@oh-my-pi/pi-coding-agent/export/html";
import { removeWithRetries } from "@oh-my-pi/pi-utils";

/**
 * Contract: the retained HTML exporter ignores the upstream compatibility flag
 * and never publishes adjacent subagent transcripts.
 */

function sessionJsonl(id: string, entryIds: string[]): string {
	const lines = [
		JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-06-12T00:00:00.000Z", cwd: "/tmp" }),
	];
	let parent: string | null = null;
	for (const entryId of entryIds) {
		lines.push(
			JSON.stringify({
				type: "model_change",
				id: entryId,
				parentId: parent,
				timestamp: "2026-06-12T00:00:01.000Z",
				model: "test/model",
			}),
		);
		parent = entryId;
	}
	return `${lines.join("\n")}\n`;
}

function sessionDataFromHtml(html: string): SessionData {
	const encoded = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/)?.[1];
	expect(encoded).toBeDefined();
	return JSON.parse(Buffer.from(encoded ?? "", "base64").toString("utf8")) as SessionData;
}

describe("HTML sub-session boundary", () => {
	let root: string;
	let mainFile: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-subsessions-"));
		mainFile = path.join(root, "main.jsonl");
		await Bun.write(mainFile, sessionJsonl("main", ["m1"]));
	});

	afterEach(async () => {
		await removeWithRetries(root);
	});

	test("does not embed adjacent subagent transcripts even when explicitly requested", async () => {
		await Bun.write(path.join(root, "main/Alpha.jsonl"), sessionJsonl("alpha", ["a1", "a2"]));
		await Bun.write(path.join(root, "main/Alpha/Child.jsonl"), sessionJsonl("child", ["c1"]));
		const outputPath = path.join(root, "session.html");
		await exportFromFile(mainFile, { includeSubSessions: true, outputPath });

		const data = sessionDataFromHtml(await Bun.file(outputPath).text());
		expect(data.header?.id).toBe("main");
		expect(data.entries.map(entry => entry.id)).toEqual(["m1"]);
		expect(data.subSessions).toBeUndefined();
	});
});
