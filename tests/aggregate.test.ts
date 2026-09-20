import { describe, it, expect } from "vitest";
import { parseTaskLine } from "../src/parse";
import {
	aggregateTasks,
	matchesDueWindow,
	DEFAULT_FILTER,
	type AggregateFilter,
	type TaskRecord,
} from "../src/aggregate";
import type { Clock } from "../src/dates";

// Fixed clock: Saturday 2026-09-19 (matches the convention in tests/dates.test.ts).
const fixedClock: Clock = () => new Date(2026, 8, 19);

function record(raw: string, filePath = "Work.md", line = 0): TaskRecord {
	const task = parseTaskLine(raw);
	if (!task) throw new Error("fixture line did not parse");
	return { task, filePath, line };
}

describe("matchesDueWindow", () => {
	it("'all' matches everything including no due date", () => {
		expect(matchesDueWindow(null, "all", fixedClock)).toBe(true);
		expect(matchesDueWindow("2026-01-01", "all", fixedClock)).toBe(true);
	});

	it("'none' matches only tasks with no due date", () => {
		expect(matchesDueWindow(null, "none", fixedClock)).toBe(true);
		expect(matchesDueWindow("2026-09-19", "none", fixedClock)).toBe(false);
	});

	it("'overdue' matches only due dates before today", () => {
		expect(matchesDueWindow("2026-09-18", "overdue", fixedClock)).toBe(true);
		expect(matchesDueWindow("2026-09-19", "overdue", fixedClock)).toBe(false);
		expect(matchesDueWindow(null, "overdue", fixedClock)).toBe(false);
	});

	it("'today' matches only exactly today", () => {
		expect(matchesDueWindow("2026-09-19", "today", fixedClock)).toBe(true);
		expect(matchesDueWindow("2026-09-20", "today", fixedClock)).toBe(false);
	});

	it("'this-week' matches today through 6 days out, inclusive", () => {
		expect(matchesDueWindow("2026-09-19", "this-week", fixedClock)).toBe(true);
		expect(matchesDueWindow("2026-09-25", "this-week", fixedClock)).toBe(true);
		expect(matchesDueWindow("2026-09-26", "this-week", fixedClock)).toBe(false);
		expect(matchesDueWindow("2026-09-18", "this-week", fixedClock)).toBe(false);
	});
});

describe("aggregateTasks", () => {
	const records: TaskRecord[] = [
		record("- [ ] (A) Call bank +Finance #calls due:2026-09-18", "Work.md", 0), // overdue
		record("- [ ] (B) Renew insurance +Admin #calls due:2026-09-19", "Work.md", 1), // today
		record("- [ ] Buy groceries +Personal #errands", "Daily.md", 0), // no due
		record("- [x] 2026-09-19 Pay bill +Finance due:2026-09-15", "Work.md", 2), // done
	];

	it("excludes done tasks by default", () => {
		const result = aggregateTasks(records, DEFAULT_FILTER, fixedClock);
		expect(result.every((r) => !r.task.done)).toBe(true);
	});

	it("includes done tasks when includeDone is true", () => {
		const filter: AggregateFilter = { ...DEFAULT_FILTER, includeDone: true };
		const result = aggregateTasks(records, filter, fixedClock);
		expect(result.some((r) => r.task.done)).toBe(true);
	});

	it("filters by context with AND semantics", () => {
		const filter: AggregateFilter = { ...DEFAULT_FILTER, contexts: ["calls"] };
		const result = aggregateTasks(records, filter, fixedClock);
		expect(result).toHaveLength(2);
		expect(result.every((r) => r.task.contexts.includes("calls"))).toBe(true);
	});

	it("filters by project", () => {
		const filter: AggregateFilter = { ...DEFAULT_FILTER, projects: ["Personal"] };
		const result = aggregateTasks(records, filter, fixedClock);
		expect(result).toHaveLength(1);
		expect(result[0].filePath).toBe("Daily.md");
	});

	it("filters by due window", () => {
		const filter: AggregateFilter = { ...DEFAULT_FILTER, dueWindow: "overdue" };
		const result = aggregateTasks(records, filter, fixedClock);
		expect(result).toHaveLength(1);
		expect(result[0].task.due).toBe("2026-09-18");
	});

	it("sorts results by priority then due date ascending", () => {
		const result = aggregateTasks(records, DEFAULT_FILTER, fixedClock);
		expect(result.map((r) => r.task.priority)).toEqual(["A", "B", null]);
	});
});
