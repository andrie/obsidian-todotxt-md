import { describe, it, expect } from "vitest";
import type { NoteMeta } from "../src/noteMeta";
import {
	extractFileVocab,
	extractNoteVocab,
	mergeVocab,
	rankVocab,
	isInScanFolders,
	adjustVocab,
} from "../src/vocab";

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

	it("offers an exact match even when it is used only once elsewhere", () => {
		const used = new Map([["Fin", 1]]);
		expect(rankVocab(used, "Fin", 10).map((e) => e.name)).toEqual(["Fin"]);
	});
});

describe("adjustVocab", () => {
	it("swaps one file's cached contribution for its live content", () => {
		// The open note was autosaved with a half-typed "+Finan"; the live text no longer has it.
		const cachedActive = extractFileVocab(["- [ ] a +Finan"]);
		const other = extractFileVocab(["- [ ] b +Finance"]);
		const base = mergeVocab([cachedActive, other]);
		const live = extractFileVocab([]);
		const adjusted = adjustVocab(base, cachedActive, live);
		expect(adjusted.project.has("Finan")).toBe(false);
		expect(adjusted.project.get("Finance")).toBe(1);
	});

	it("adds live content when the file has no cached entry", () => {
		const base = mergeVocab([extractFileVocab(["- [ ] b +Work"])]);
		const adjusted = adjustVocab(base, undefined, extractFileVocab(["- [ ] a +Work @home"]));
		expect(adjusted.project.get("Work")).toBe(2);
		expect(adjusted.at.get("home")).toBe(1);
	});

	it("does not mutate the base vocabulary", () => {
		const cached = extractFileVocab(["- [ ] a +Fin"]);
		const base = mergeVocab([cached]);
		adjustVocab(base, cached, extractFileVocab([]));
		expect(base.project.get("Fin")).toBe(1);
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

describe("extractNoteVocab", () => {
	const lines = ["- [ ] buy milk +Shop @store", "not a task +Ignored"];

	it("is empty for an ignored note", () => {
		const meta: NoteMeta = { ignore: true, projects: ["Home"], contexts: [] };
		const vocab = extractNoteVocab(meta, lines);
		expect(vocab.project.size).toBe(0);
		expect(vocab.at.size).toBe(0);
		expect(vocab.hash.size).toBe(0);
	});

	it("matches extractFileVocab when the note declares nothing", () => {
		const meta: NoteMeta = { ignore: false, projects: [], contexts: [] };
		expect(extractNoteVocab(meta, lines)).toEqual(extractFileVocab(lines));
	});

	it("adds inherited names, summed with typed uses", () => {
		const meta: NoteMeta = {
			ignore: false,
			projects: ["Shop", "Home"],
			contexts: [
				{ name: "store", prefix: "@" },
				{ name: "errand", prefix: "#" },
			],
		};
		const vocab = extractNoteVocab(meta, lines);
		expect(vocab.project.get("Shop")).toBe(2);
		expect(vocab.project.get("Home")).toBe(1);
		expect(vocab.at.get("store")).toBe(2);
		expect(vocab.hash.get("errand")).toBe(1);
	});
});
