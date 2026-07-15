import { beforeAll, describe, expect, test, vi } from "bun:test";
import { KEYBINDINGS } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import { CustomEditor } from "@oh-my-pi/pi-coding-agent/modes/components/custom-editor";
import { SessionSelectorComponent } from "@oh-my-pi/pi-coding-agent/modes/components/session-selector";
import { getEditorTheme, initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { SessionInfo } from "@oh-my-pi/pi-coding-agent/session/session-listing";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import type { SessionStorage } from "@oh-my-pi/pi-coding-agent/session/session-storage";

beforeAll(async () => {
	await initTheme();
});

function session(id: string, title: string, cwd = "/work/current"): SessionInfo {
	return {
		path: `${cwd}/${id}.jsonl`,
		id,
		cwd,
		title,
		created: new Date("2024-01-01T00:00:00Z"),
		modified: new Date("2024-01-02T00:00:00Z"),
		messageCount: 1,
		size: 1024,
		firstMessage: `${title} first message`,
		allMessagesText: `hidden transcript marker for ${id}`,
		status: "complete",
		parentSessionPath: "/work/current/parent.jsonl",
	};
}

describe("Pi session selector boundary", () => {
	test("stays a plain current-project list even when rich OMP options are supplied", async () => {
		const local = [session("alpha", "Alpha"), session("beta", "Beta")];
		const remote = session("remote", "Remote", "/work/other-project");
		const loadAllSessions = vi.fn(async () => [remote]);
		const onDelete = vi.fn(async () => true);
		const historyMatcher = vi.fn(() => [remote.id]);
		const selected: SessionInfo[] = [];
		const selector = new SessionSelectorComponent(
			local,
			value => selected.push(value),
			() => {},
			() => {},
			{ loadAllSessions, allSessions: [remote], onDelete, historyMatcher },
		);

		const initial = Bun.stripANSI(selector.render(100).join("\n"));
		expect(initial).toContain("Resume Session");
		expect(initial).toContain("Alpha");
		expect(initial).toContain("Beta");
		for (const hidden of [
			"current folder",
			"all projects",
			"other-project",
			"hidden transcript marker",
			"done",
			"fork",
			"1.0 KB",
			"delete",
			"Tab",
		]) {
			expect(initial).not.toContain(hidden);
		}

		selector.handleInput("hidden transcript marker");
		selector.handleInput("\t");
		selector.handleInput("\x1b[3~");
		selector.handleInput("\x7f");
		await Bun.sleep(0);

		const afterDisabledInputs = Bun.stripANSI(selector.render(100).join("\n"));
		expect(afterDisabledInputs).toContain("Alpha");
		expect(afterDisabledInputs).toContain("Beta");
		expect(afterDisabledInputs).not.toContain("Remote");
		expect(afterDisabledInputs).not.toContain("Delete session?");
		expect(loadAllSessions).not.toHaveBeenCalled();
		expect(historyMatcher).not.toHaveBeenCalled();
		expect(onDelete).not.toHaveBeenCalled();

		selector.handleInput("\x1b[B");
		selector.handleInput("\n");
		expect(selected.map(value => value.id)).toEqual(["beta"]);
	});
});

describe("Pi direct session API boundary", () => {
	test("guards labels, summary branches, and cross-project listing before state access", async () => {
		const manager = SessionManager.inMemory("/work/current");
		const root = manager.appendMessage({ role: "user", content: "root", timestamp: 1 });
		const before = manager.getEntries();

		expect(() => manager.appendLabelChange(root, "checkpoint")).toThrow("unavailable in Pi");
		expect(() => manager.branchWithSummary(root, "summary")).toThrow("unavailable in Pi");
		expect(manager.getEntries()).toEqual(before);

		const untouchedStorage = new Proxy({} as SessionStorage, {
			get() {
				throw new Error("storage was touched");
			},
		});
		await expect(SessionManager.listAll(untouchedStorage)).rejects.toThrow("unavailable in Pi");
	});

	test("preserves baseline branch navigation", () => {
		const manager = SessionManager.inMemory("/work/current");
		const root = manager.appendMessage({ role: "user", content: "root", timestamp: 1 });
		manager.appendMessage({ role: "user", content: "abandoned", timestamp: 2 });

		manager.branch(root);
		const active = manager.appendMessage({ role: "user", content: "active", timestamp: 3 });

		expect(manager.getLeafId()).toBe(active);
		expect(manager.getBranch().map(entry => entry.id)).toEqual([root, active]);
	});
});

describe("Pi editor history boundary", () => {
	test("keeps Ctrl-R prompt search alongside ordinary Up history", () => {
		expect(KEYBINDINGS["app.history.search"].defaultKeys).toBe("ctrl+r");

		const editor = new CustomEditor(getEditorTheme());
		const onHistorySearch = vi.fn();
		editor.setActionKeys("app.history.search", ["ctrl+r"]);
		editor.onHistorySearch = onHistorySearch;
		editor.handleInput("\x12");

		expect(onHistorySearch).toHaveBeenCalledTimes(1);

		editor.addToHistory("older prompt");
		editor.handleInput("\x1b[A");

		expect(editor.getText()).toBe("older prompt");
	});
});
