import { describe, it, expect } from "vitest";
import { detectTrigger, isSingleSpaceInsertion, TypedSpaceTracker } from "../src/triggers";

const on = { fieldMenu: true };
const off = { fieldMenu: false };

function at(line: string, opts = on) {
	return detectTrigger(line, line.length, opts);
}

describe("date triggers (behaviour moved from dateSuggest.ts)", () => {
	it("fires on a leading bare colon right after the checkbox", () => {
		expect(at("- [ ] :tod")).toEqual({ kind: "date", start: 6, end: 10, query: "tod" });
	});

	it("excludes the priority prefix from the replacement span", () => {
		expect(at("- [ ] (A) :tod")).toEqual({ kind: "date", start: 10, end: 14, query: "tod" });
	});

	it("fires after due: and t:", () => {
		expect(at("- [ ] Call bank due:to")).toEqual({ kind: "date", start: 20, end: 22, query: "to" });
		expect(at("- [ ] x t:mon")).toEqual({ kind: "date", start: 10, end: 13, query: "mon" });
	});

	it("accepts relative offsets after due:", () => {
		expect(at("- [ ] x due:+3d")?.kind).toBe("date");
		expect(at("- [ ] x due:+3d")?.query).toBe("+3d");
	});

	it("does not fire when due: is glued to a tag", () => {
		expect(at("- [ ] Call +Finance #due:tod")).toBeNull();
	});
});

describe("non-task and prose lines", () => {
	it("never fires on a non-checkbox line", () => {
		expect(at("Call bank due:tod")).toBeNull();
		expect(at("- plain bullet +Fin")).toBeNull();
	});

	it("does not fire on an email-like @ or a mid-word +", () => {
		expect(at("- [ ] mail a@b.com")).toBeNull();
		expect(at("- [ ] c++")).toBeNull();
	});
});

describe("priority trigger", () => {
	it("fires on a bare ! with no priority present", () => {
		expect(at("- [ ] !")).toEqual({ kind: "priority", start: 6, end: 7, query: "" });
		expect(at("- [ ] Call !b")).toEqual({ kind: "priority", start: 11, end: 13, query: "b" });
	});

	it("does not fire when the task already has a priority (including lowercase)", () => {
		expect(at("- [ ] (A) !")).toBeNull();
		expect(at("- [ ] (a) !")).toBeNull();
	});

	it("does not fire when ! ends a word", () => {
		expect(at("- [ ] Call bank!")).toBeNull();
	});
});

describe("project and @ triggers", () => {
	it("fires on + and @ with the typed query, span starting at the symbol", () => {
		expect(at("- [ ] Call +Fi")).toEqual({ kind: "project", start: 11, end: 14, query: "Fi" });
		expect(at("- [ ] x @")).toEqual({ kind: "at", start: 8, end: 9, query: "" });
		expect(at("- [ ] x @ho")).toEqual({ kind: "at", start: 8, end: 11, query: "ho" });
	});

	it("does not fire on # (Obsidian's native tag popup owns it)", () => {
		expect(at("- [ ] x #ca")).toBeNull();
	});
});

describe("field menu trigger", () => {
	it("fires on a single space after a word, with an empty span at the cursor", () => {
		expect(at("- [ ] Call ")).toEqual({ kind: "field", start: 11, end: 11, query: "" });
	});

	it("is off when the setting is off", () => {
		expect(at("- [ ] Call ", off)).toBeNull();
	});

	it("fires on a new empty task so priority can be entered first", () => {
		expect(at("- [ ] ")).toEqual({ kind: "field", start: 6, end: 6, query: "" });
		expect(at("  - [ ] ")).toEqual({ kind: "field", start: 8, end: 8, query: "" });
	});

	it("does not fire on an empty body without the space, or with text after the cursor", () => {
		expect(at("- [ ]")).toBeNull();
		expect(detectTrigger("- [ ] foo", 6, on)).toBeNull();
	});

	it("does not fire on a new task when the setting is off", () => {
		expect(at("- [ ] ", off)).toBeNull();
	});

	it("does not fire after a double space", () => {
		expect(at("- [ ] x  ")).toBeNull();
	});

	it("works on indented checkboxes", () => {
		expect(at("  - [ ] Call ")).toEqual({ kind: "field", start: 13, end: 13, query: "" });
		expect(at("  - [ ] :tod")?.start).toBe(8);
	});

	it("uses the cursor position, not the end of the line", () => {
		expect(detectTrigger("- [ ] Call bank", 11, on)).toEqual({
			kind: "field",
			start: 11,
			end: 11,
			query: "",
		});
	});

	it("does not fire with the cursor inside the checkbox prefix", () => {
		expect(detectTrigger("- [ ] Call ", 3, on)).toBeNull();
	});
});

describe("isSingleSpaceInsertion", () => {
	it("is true when exactly one space was typed at ch-1", () => {
		expect(isSingleSpaceInsertion("- [ ] Call", "- [ ] Call ", 11)).toBe(true);
		expect(isSingleSpaceInsertion("- [ ] Callbank", "- [ ] Call bank", 11)).toBe(true);
	});

	it("is false for cursor-only moves and other edits", () => {
		expect(isSingleSpaceInsertion("- [ ] Call ", "- [ ] Call ", 11)).toBe(false);
		expect(isSingleSpaceInsertion("- [ ] Call +Fi", "- [ ] Call +Finance ", 20)).toBe(false);
		expect(isSingleSpaceInsertion("- [ ] Call", "- [ ] Call x", 12)).toBe(false);
	});
});

describe("TypedSpaceTracker", () => {
	it("allows the menu right after a typed space, and for unchanged re-checks", () => {
		const t = new TypedSpaceTracker();
		t.observe(0, "- [ ] Call", 10);
		t.observe(0, "- [ ] Call ", 11);
		expect(t.isTyped(0, "- [ ] Call ", 11)).toBe(true);
		t.observe(0, "- [ ] Call ", 11);
		expect(t.isTyped(0, "- [ ] Call ", 11)).toBe(true);
	});

	it("does not allow the menu when the cursor merely lands after a space", () => {
		const t = new TypedSpaceTracker();
		t.observe(0, "- [ ] Call bank", 15);
		t.observe(0, "- [ ] Call bank", 11);
		expect(t.isTyped(0, "- [ ] Call bank", 11)).toBe(false);
	});

	it("does not allow the menu after a selection leaves a trailing space", () => {
		const t = new TypedSpaceTracker();
		t.observe(0, "- [ ] Call +Fi", 14);
		t.observe(0, "- [ ] Call +Finance ", 20);
		expect(t.isTyped(0, "- [ ] Call +Finance ", 20)).toBe(false);
	});

	it("closes once the cursor moves, the text changes, or the line differs", () => {
		const t = new TypedSpaceTracker();
		t.observe(0, "- [ ] Call", 10);
		t.observe(0, "- [ ] Call ", 11);
		expect(t.isTyped(0, "- [ ] Call ", 5)).toBe(false);
		expect(t.isTyped(1, "- [ ] Call ", 11)).toBe(false);
		t.observe(0, "- [ ] Call x", 12);
		expect(t.isTyped(0, "- [ ] Call x", 12)).toBe(false);
	});

	it("does not treat a first observation as typed", () => {
		const t = new TypedSpaceTracker();
		t.observe(0, "- [ ] Call ", 11);
		expect(t.isTyped(0, "- [ ] Call ", 11)).toBe(false);
	});
});

describe("TypedSpaceTracker: new tasks", () => {
	it("allows the menu on a task line just created by Enter (one more line, cursor at end)", () => {
		const t = new TypedSpaceTracker();
		t.observe(0, "- [ ] Call bank", 15, 3);
		t.observe(1, "- [ ] ", 6, 4);
		expect(t.isTyped(1, "- [ ] ", 6)).toBe(true);
	});

	it("allows the menu when the space after an empty checkbox is typed", () => {
		const t = new TypedSpaceTracker();
		t.observe(1, "- [ ]", 5, 4);
		t.observe(1, "- [ ] ", 6, 4);
		expect(t.isTyped(1, "- [ ] ", 6)).toBe(true);
	});

	it("does not allow the menu when the cursor merely moves onto an existing empty task", () => {
		const t = new TypedSpaceTracker();
		t.observe(0, "- [ ] Call bank", 15, 4);
		t.observe(1, "- [ ] ", 6, 4);
		expect(t.isTyped(1, "- [ ] ", 6)).toBe(false);
	});

	it("does not treat a mid-line Enter split as a new task start", () => {
		const t = new TypedSpaceTracker();
		t.observe(0, "- [ ] foobar", 9, 3);
		t.observe(1, "- [ ] bar", 6, 4);
		expect(t.isTyped(1, "- [ ] bar", 6)).toBe(false);
	});

	it("closes the new-task menu once the cursor moves or text is typed", () => {
		const t = new TypedSpaceTracker();
		t.observe(0, "- [ ] Call", 10, 3);
		t.observe(1, "- [ ] ", 6, 4);
		t.observe(1, "- [ ] x", 7, 4);
		expect(t.isTyped(1, "- [ ] x", 7)).toBe(false);
	});
});
