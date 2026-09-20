import { describe, it, expect } from "vitest";
import { parseTaskLine } from "../src/parse";
import { sortLines, compareTasks } from "../src/sort";

describe("sortLines", () => {
	it("orders by priority ascending, none last", () => {
		const input = ["- [ ] (B) second", "- [ ] no priority", "- [ ] (A) first"];
		expect(sortLines(input)).toEqual(["- [ ] (A) first", "- [ ] (B) second", "- [ ] no priority"]);
	});

	it("breaks priority ties by due date ascending, no due date last", () => {
		const input = [
			"- [ ] (A) later due:2026-09-30",
			"- [ ] (A) no due",
			"- [ ] (A) earlier due:2026-09-20",
		];
		expect(sortLines(input)).toEqual([
			"- [ ] (A) earlier due:2026-09-20",
			"- [ ] (A) later due:2026-09-30",
			"- [ ] (A) no due",
		]);
	});

	it("breaks remaining ties by creation date ascending", () => {
		const input = ["- [ ] 2026-09-19 newer", "- [ ] 2026-09-01 older"];
		expect(sortLines(input)).toEqual(["- [ ] 2026-09-01 older", "- [ ] 2026-09-19 newer"]);
	});

	it("is stable for fully-tied lines", () => {
		const input = ["- [ ] task one", "- [ ] task two"];
		expect(sortLines(input)).toEqual(input);
	});

	it("does not mutate the input array", () => {
		const input = ["- [ ] (B) x", "- [ ] (A) y"];
		const copy = [...input];
		sortLines(input);
		expect(input).toEqual(copy);
	});

	it("sorts non-task lines after all task lines", () => {
		const input = ["not a task", "- [ ] (A) a task"];
		expect(sortLines(input)).toEqual(["- [ ] (A) a task", "not a task"]);
	});
});

describe("compareTasks", () => {
	function task(raw: string) {
		const parsed = parseTaskLine(raw);
		if (!parsed) throw new Error("fixture line did not parse");
		return parsed;
	}

	it("orders by priority ascending, none last", () => {
		const a = task("- [ ] (A) first");
		const b = task("- [ ] (B) second");
		const none = task("- [ ] no priority");
		expect(compareTasks(a, b)).toBeLessThan(0);
		expect(compareTasks(b, none)).toBeLessThan(0);
	});

	it("matches compareLines behavior via sortLines on equivalent input", () => {
		const lines = ["- [ ] (B) second", "- [ ] no priority", "- [ ] (A) first"];
		const tasks = lines.map(task).sort(compareTasks);
		expect(tasks.map((t) => t.description)).toEqual(["first", "second", "no priority"]);
	});
});
