import { describe, it, expect } from "vitest";
import { parseTaskLine } from "../src/parse";
import {
	cycleStatus,
	createTaskLine,
	startIfEnteredProgress,
	bumpPriorityAtCursor,
	sortBlockAtCursor,
} from "../src/editor";
import type { Clock } from "../src/dates";

const fixedClock: Clock = () => new Date(2026, 8, 19);

function task(raw: string) {
	const parsed = parseTaskLine(raw);
	if (!parsed) throw new Error("fixture line did not parse");
	return parsed;
}

describe("bumpPriorityAtCursor", () => {
	function fakeEditor(line: string) {
		let text = line;
		let cursor = { line: 0, ch: 0 };
		return {
			getCursor: () => cursor,
			getLine: (n: number) => (n === 0 ? text : ""),
			replaceRange: (newText: string) => {
				text = newText;
			},
			setCursor: (pos: { line: number; ch: number }) => {
				cursor = pos;
			},
			getText: () => text,
		};
	}

	it("passes the configured default priority through when increasing from none", () => {
		const editor = fakeEditor("- [ ] Call the bank");
		bumpPriorityAtCursor(editor as never, -1, "C");
		expect(editor.getText()).toContain("(C)");
	});
});

describe("sortBlockAtCursor", () => {
	function fakeEditor(lines: string[], cursorLine: number) {
		let content = lines;
		let cursor = { line: cursorLine, ch: 3 };
		return {
			getCursor: () => cursor,
			getLine: (n: number) => content[n] ?? "",
			lastLine: () => content.length - 1,
			replaceRange: (newText: string, from: { line: number }, to: { line: number }) => {
				const replacement = newText.split("\n");
				content = [...content.slice(0, from.line), ...replacement, ...content.slice(to.line + 1)];
			},
			setCursor: (pos: { line: number; ch: number }) => {
				cursor = pos;
			},
			getContent: () => content,
			getFinalCursor: () => cursor,
		};
	}

	it("re-anchors the cursor to the same line index when two lines are identical text", () => {
		// Both "- [ ] (B) dup" lines are textually identical; cursor starts on the SECOND one
		// (index 2). A naive indexOf-based re-anchor would always find the FIRST "(B) dup" line
		// after sorting, which is index 1 post-sort (still identical text) -- so this test needs
		// distinguishing context to actually prove which physical line moved where. Use two
		// distinct-priority lines plus one duplicate pair, and assert the duplicate cursor line's
		// *relative order among duplicates* is preserved (index 2 of the original 3 duplicate-free
		// entries maps deterministically under a stable sort).
		const lines = ["- [ ] (B) dup", "- [ ] (A) unique", "- [ ] (B) dup"];
		const editor = fakeEditor(lines, 2); // cursor starts on the SECOND "(B) dup" line
		sortBlockAtCursor(editor as never);

		// After sorting: [(A) unique, (B) dup, (B) dup] -- the two "(B) dup" lines keep their
		// relative order (stable sort), so the SECOND original "(B) dup" (the one the cursor was
		// on) is now at index 2, not index 1.
		expect(editor.getContent()).toEqual(["- [ ] (A) unique", "- [ ] (B) dup", "- [ ] (B) dup"]);
		expect(editor.getFinalCursor().line).toBe(2);
	});
});

describe("cycleStatus", () => {
	it("open -> in progress adds start: today and leaves creation date alone", () => {
		const result = cycleStatus(task("- [ ] 2026-09-01 Call the bank"), fixedClock);
		expect(result.status).toBe("progress");
		expect(result.start).toBe("2026-09-19");
		expect(result.creationDate).toBe("2026-09-01");
		expect(result.completionDate).toBeNull();
	});

	it("open -> in progress does not invent a creation date", () => {
		expect(cycleStatus(task("- [ ] Call the bank"), fixedClock).creationDate).toBeNull();
	});

	it("in progress -> done adds the completion date and keeps start:", () => {
		const result = cycleStatus(task("- [/] 2026-09-01 Call the bank start:2026-09-10"), fixedClock);
		expect(result.status).toBe("done");
		expect(result.completionDate).toBe("2026-09-19");
		expect(result.creationDate).toBe("2026-09-01");
		expect(result.start).toBe("2026-09-10");
	});

	it("in progress -> done fills a missing creation date with the completion date", () => {
		const result = cycleStatus(task("- [/] Call the bank start:2026-09-10"), fixedClock);
		expect(result.completionDate).toBe("2026-09-19");
		expect(result.creationDate).toBe("2026-09-19");
	});

	it("done -> open removes the completion date and start: but keeps the creation date", () => {
		const result = cycleStatus(
			task("- [x] 2026-09-19 2026-09-01 Call the bank start:2026-09-10"),
			fixedClock,
		);
		expect(result.status).toBe("open");
		expect(result.completionDate).toBeNull();
		expect(result.start).toBeNull();
		expect(result.creationDate).toBe("2026-09-01");
	});

	it("leaves due: untouched on every step", () => {
		const result = cycleStatus(task("- [ ] Call the bank due:2026-09-25"), fixedClock);
		expect(result.due).toBe("2026-09-25");
	});

	it("does not mutate the input task", () => {
		const input = task("- [ ] Call the bank");
		cycleStatus(input, fixedClock);
		expect(input.status).toBe("open");
	});
});

describe("createTaskLine", () => {
	it("starts an open task with today as the creation date", () => {
		expect(createTaskLine("", fixedClock)).toBe("- [ ] 2026-09-19 ");
	});

	it("keeps the indentation of the current line", () => {
		expect(createTaskLine("  ", fixedClock)).toBe("  - [ ] 2026-09-19 ");
	});
});

describe("startIfEnteredProgress", () => {
	it("adds start: when a line has just become [/]", () => {
		expect(startIfEnteredProgress("- [ ] Call", "- [/] Call", fixedClock)).toBe(
			"- [/] Call start:2026-09-19",
		);
	});

	it("does nothing when the line already has start:", () => {
		expect(
			startIfEnteredProgress(
				"- [ ] Call start:2026-09-01",
				"- [/] Call start:2026-09-01",
				fixedClock,
			),
		).toBeNull();
	});

	it("does nothing when the line was already in progress", () => {
		expect(startIfEnteredProgress("- [/] Call", "- [/] Call more", fixedClock)).toBeNull();
	});

	it("does nothing for a non-progress change or a non-task line", () => {
		expect(startIfEnteredProgress("- [ ] Call", "- [x] Call", fixedClock)).toBeNull();
		expect(startIfEnteredProgress("Call", "- [/] Call", fixedClock)).toBe(
			"- [/] Call start:2026-09-19",
		);
		expect(startIfEnteredProgress("- [ ] a", "plain text", fixedClock)).toBeNull();
	});
});
