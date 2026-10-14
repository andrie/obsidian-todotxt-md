import { describe, it, expect } from "vitest";
import {
	suggestFields,
	planReplace,
	planFieldEdit,
	planPriorityEdit,
	applyEditPlan,
} from "../src/suggestFields";
import type { Clock } from "../src/dates";

// Saturday 2026-09-19 (same convention as tests/dates.test.ts).
const fixedClock: Clock = () => new Date(2026, 8, 19);

const kinds = (line: string) => suggestFields(line, fixedClock).map((s) => s.kind);

describe("suggestFields", () => {
	it("offers every field on a bare task, in fixed order", () => {
		expect(kinds("- [ ] Call bank")).toEqual([
			"priority",
			"created",
			"due",
			"threshold",
			"project",
			"at",
			"hash",
		]);
	});

	it("omits fields already present", () => {
		expect(kinds("- [ ] (A) 2026-09-01 Call due:2026-09-25 t:2026-09-20")).toEqual([
			"project",
			"at",
			"hash",
		]);
	});

	it("treats a lowercase (a) as an existing priority", () => {
		expect(kinds("- [ ] (a) Call")).not.toContain("priority");
	});

	it("omits created on a done task (its leading date is the completion date)", () => {
		expect(kinds("- [x] 2026-09-19 Call")).toEqual([
			"priority",
			"due",
			"threshold",
			"project",
			"at",
			"hash",
		]);
	});

	it("shows today's ISO date as the created row's hint", () => {
		const created = suggestFields("- [ ] Call", fixedClock).find((s) => s.kind === "created");
		expect(created?.hint).toBe("2026-09-19");
	});

	it("returns nothing for a non-task line", () => {
		expect(kinds("Call bank")).toEqual([]);
	});
});

describe("planReplace", () => {
	it("replaces the span and puts the cursor after the inserted text", () => {
		const line = "- [ ] :tod";
		const plan = planReplace({ start: 6, end: 10 }, "2026-09-19");
		expect(applyEditPlan(line, plan)).toBe("- [ ] 2026-09-19");
		expect(plan.cursor).toBe(16);
	});
});

describe("planFieldEdit", () => {
	it("inserts transient due: at the cursor and moves the cursor after it", () => {
		const line = "- [ ] Call ";
		const plan = planFieldEdit(line, 11, "due", fixedClock);
		expect(plan && applyEditPlan(line, plan)).toBe("- [ ] Call due:");
		expect(plan?.cursor).toBe(15);
	});

	it.each([
		["threshold", "t:"],
		["project", "+"],
		["at", "@"],
		["hash", "#"],
		["priority", "!"],
	] as const)("inserts the transient %s trigger text", (kind, text) => {
		const line = "- [ ] Call ";
		const plan = planFieldEdit(line, 11, kind, fixedClock);
		expect(plan && applyEditPlan(line, plan)).toBe(`- [ ] Call ${text}`);
		expect(plan?.cursor).toBe(11 + text.length);
	});

	it("inserts today's date in the leading slot and keeps the cursor after the typed text", () => {
		const line = "- [ ] Call bank ";
		const plan = planFieldEdit(line, 16, "created", fixedClock);
		expect(plan && applyEditPlan(line, plan)).toBe("- [ ] 2026-09-19 Call bank ");
		expect(plan?.cursor).toBe(27);
	});

	it("puts the created date after an existing priority", () => {
		const line = "- [ ] (A) Call ";
		const plan = planFieldEdit(line, 15, "created", fixedClock);
		expect(plan && applyEditPlan(line, plan)).toBe("- [ ] (A) 2026-09-19 Call ");
		expect(plan?.cursor).toBe(26);
	});

	it("refuses created on a done task or one that already has a creation date", () => {
		expect(planFieldEdit("- [x] 2026-09-19 Call ", 22, "created", fixedClock)).toBeNull();
		expect(planFieldEdit("- [ ] 2026-09-01 Call ", 22, "created", fixedClock)).toBeNull();
	});

	it("returns null for a non-task line", () => {
		expect(planFieldEdit("Call ", 5, "due", fixedClock)).toBeNull();
	});
});

describe("planPriorityEdit", () => {
	it("moves a trailing !query to the leading slot as (X), swallowing the space before it", () => {
		const line = "- [ ] Call bank !";
		const plan = planPriorityEdit(line, { start: 16, end: 17 }, "A");
		expect(plan && applyEditPlan(line, plan)).toBe("- [ ] (A) Call bank");
		expect(plan?.cursor).toBe(19);
	});

	it("handles a mid-line !query without eating the following text", () => {
		const line = "- [ ] Call !b more";
		const plan = planPriorityEdit(line, { start: 11, end: 13 }, "A");
		expect(plan && applyEditPlan(line, plan)).toBe("- [ ] (A) Call more");
		expect(plan?.cursor).toBe(14);
	});

	it("replaces a leading !query in place without doubling the space", () => {
		const line = "- [ ] !a rest";
		const plan = planPriorityEdit(line, { start: 6, end: 8 }, "B");
		expect(plan && applyEditPlan(line, plan)).toBe("- [ ] (B) rest");
		expect(plan?.cursor).toBe(9);
	});

	it("handles a lone leading ! at end of line", () => {
		const line = "- [ ] !";
		const plan = planPriorityEdit(line, { start: 6, end: 7 }, "A");
		expect(plan && applyEditPlan(line, plan)).toBe("- [ ] (A)");
		expect(plan?.cursor).toBe(9);
	});

	it("on a done task, inserts after the completion date, not before it", () => {
		const line = "- [x] 2026-09-19 Call !";
		const plan = planPriorityEdit(line, { start: 22, end: 23 }, "A");
		expect(plan && applyEditPlan(line, plan)).toBe("- [x] 2026-09-19 (A) Call");
	});

	it("works on an indented checkbox", () => {
		const line = "  - [ ] Call !";
		const plan = planPriorityEdit(line, { start: 13, end: 14 }, "A");
		expect(plan && applyEditPlan(line, plan)).toBe("  - [ ] (A) Call");
	});

	it("normalises a lowercase letter and rejects non-letters", () => {
		const line = "- [ ] !b rest";
		expect(planPriorityEdit(line, { start: 6, end: 8 }, "b")).not.toBeNull();
		expect(planPriorityEdit(line, { start: 6, end: 8 }, "1")).toBeNull();
	});

	it("refuses when a priority already exists", () => {
		expect(planPriorityEdit("- [ ] (A) x !", { start: 12, end: 13 }, "B")).toBeNull();
	});
});
