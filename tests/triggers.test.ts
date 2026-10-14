import { describe, it, expect } from "vitest";
import { detectTrigger } from "../src/triggers";

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

	it("never fires on an empty body (so a fresh checkbox keeps Enter as newline)", () => {
		expect(at("- [ ] ")).toBeNull();
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
