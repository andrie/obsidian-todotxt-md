import { describe, it, expect } from "vitest";
import { parseTaskLine } from "../src/parse";
import { toggleDone, bumpPriorityAtCursor, sortBlockAtCursor } from "../src/editor";
import type { Clock } from "../src/dates";

const fixedClock: Clock = () => new Date(2026, 8, 19);

function task(raw: string) {
	const parsed = parseTaskLine(raw);
	if (!parsed) throw new Error("fixture line did not parse");
	return parsed;
}

describe("toggleDone", () => {
	it("marks a not-done task as done, prepending today's completion date", () => {
		const result = toggleDone(task("- [ ] (A) 2026-09-01 Call the bank"), fixedClock);
		expect(result.done).toBe(true);
		expect(result.completionDate).toBe("2026-09-19");
		expect(result.priority).toBe("A");
		expect(result.creationDate).toBe("2026-09-01");
	});

	it("marks a done task as not-done, clearing the completion date", () => {
		const result = toggleDone(task("- [x] 2026-09-19 (A) 2026-09-01 Call the bank"), fixedClock);
		expect(result.done).toBe(false);
		expect(result.completionDate).toBeNull();
		expect(result.priority).toBe("A");
	});

	it("leaves due: untouched when marking done", () => {
		const result = toggleDone(task("- [ ] Call the bank due:2026-09-25"), fixedClock);
		expect(result.due).toBe("2026-09-25");
	});

	it("does not mutate the input task", () => {
		const input = task("- [ ] Call the bank");
		toggleDone(input, fixedClock);
		expect(input.done).toBe(false);
	});
});

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
				content = [
					...content.slice(0, from.line),
					...replacement,
					...content.slice(to.line + 1),
				];
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
		const lines = [
			"- [ ] (B) dup",
			"- [ ] (A) unique",
			"- [ ] (B) dup",
		];
		const editor = fakeEditor(lines, 2); // cursor starts on the SECOND "(B) dup" line
		sortBlockAtCursor(editor as never);

		// After sorting: [(A) unique, (B) dup, (B) dup] -- the two "(B) dup" lines keep their
		// relative order (stable sort), so the SECOND original "(B) dup" (the one the cursor was
		// on) is now at index 2, not index 1.
		expect(editor.getContent()).toEqual([
			"- [ ] (A) unique",
			"- [ ] (B) dup",
			"- [ ] (B) dup",
		]);
		expect(editor.getFinalCursor().line).toBe(2);
	});
});
