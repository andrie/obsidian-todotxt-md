import { describe, it, expect } from "vitest";
import { parseTaskLine } from "../src/parse";
import { toggleDone, bumpPriorityAtCursor } from "../src/editor";
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
