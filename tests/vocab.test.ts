import { describe, it, expect } from "vitest";
import { extractFileVocab, mergeVocab, rankVocab, isInScanFolders } from "../src/vocab";

describe("extractFileVocab", () => {
	it("counts projects, @ names and # names separately, from task lines only", () => {
		const vocab = extractFileVocab([
			"- [ ] a +Fin @home #calls",
			"- [x] b +Fin @home",
			"not a task +Ignored @nope",
		]);
		expect(vocab.project.get("Fin")).toBe(2);
		expect(vocab.at.get("home")).toBe(2);
		expect(vocab.hash.get("calls")).toBe(1);
		expect(vocab.project.has("Ignored")).toBe(false);
		expect(vocab.at.has("nope")).toBe(false);
	});

	it("keeps @home and #home in separate maps", () => {
		const vocab = extractFileVocab(["- [ ] a @home", "- [ ] b #home"]);
		expect(vocab.at.get("home")).toBe(1);
		expect(vocab.hash.get("home")).toBe(1);
	});
});

describe("mergeVocab", () => {
	it("sums counts across files", () => {
		const a = extractFileVocab(["- [ ] a +Fin", "- [ ] b +Fin"]);
		const b = extractFileVocab(["- [ ] c +Fin +Home"]);
		const merged = mergeVocab([a, b]);
		expect(merged.project.get("Fin")).toBe(3);
		expect(merged.project.get("Home")).toBe(1);
	});

	it("returns empty maps for no files", () => {
		const merged = mergeVocab([]);
		expect(merged.project.size).toBe(0);
	});
});

describe("rankVocab", () => {
	const counts = new Map([
		["Finance", 5],
		["Fitness", 5],
		["Family", 2],
		["Work", 9],
	]);

	it("orders by count descending, ties alphabetical", () => {
		expect(rankVocab(counts, "", 10).map((e) => e.name)).toEqual([
			"Work",
			"Finance",
			"Fitness",
			"Family",
		]);
	});

	it("filters by case-insensitive prefix and keeps frequency order", () => {
		expect(rankVocab(counts, "fi", 10).map((e) => e.name)).toEqual(["Finance", "Fitness"]);
	});

	it("applies the limit", () => {
		expect(rankVocab(counts, "", 2).map((e) => e.name)).toEqual(["Work", "Finance"]);
	});

	it("does not offer the token being typed back to itself when it is used once", () => {
		const typing = new Map([
			["Fin", 1],
			["Finance", 4],
		]);
		expect(rankVocab(typing, "Fin", 10).map((e) => e.name)).toEqual(["Finance"]);
	});

	it("still offers an exact match that is genuinely used more than once", () => {
		const used = new Map([["Fin", 3]]);
		expect(rankVocab(used, "Fin", 10).map((e) => e.name)).toEqual(["Fin"]);
	});
});

describe("isInScanFolders", () => {
	it("matches everything when no folders are configured", () => {
		expect(isInScanFolders("Any/Note.md", [])).toBe(true);
	});

	it("matches files inside a configured folder, not siblings with a shared prefix", () => {
		expect(isInScanFolders("Work/Note.md", ["Work"])).toBe(true);
		expect(isInScanFolders("Work2/Note.md", ["Work"])).toBe(false);
		expect(isInScanFolders("Other/Note.md", ["Work"])).toBe(false);
	});
});
