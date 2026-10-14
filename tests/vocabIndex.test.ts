import { describe, it, expect } from "vitest";
import type { App, TFile } from "obsidian";

// vocabIndex.ts is Obsidian glue; tests/stubs/obsidian.ts (aliased in vitest.config.ts) supplies
// the few runtime pieces it touches so its async behaviour can be tested in plain Node.
import { TFile as StubTFile } from "obsidian";
import { VocabIndex } from "../src/vocabIndex";

function makeFile(path: string): TFile {
	return new (StubTFile as unknown as new (p: string) => TFile)(path);
}

function fakeApp(opts: {
	files: Record<string, string>;
	cachedRead?: (file: TFile) => Promise<string>;
	getMarkdownFiles?: () => TFile[];
}): App {
	const tfiles = Object.keys(opts.files).map(makeFile);
	return {
		vault: {
			getMarkdownFiles: opts.getMarkdownFiles ?? (() => tfiles),
			cachedRead: opts.cachedRead ?? (async (file: TFile) => opts.files[file.path]),
			on: () => ({}),
			getAbstractFileByPath: (p: string) => tfiles.find((f) => f.path === p) ?? null,
		},
	} as unknown as App;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("VocabIndex", () => {
	it("a scan started before invalidate() cannot re-add files outside the new scope", async () => {
		const files = {
			"Work/a.md": "- [ ] x +Work1",
			"Other/b.md": "- [ ] y +Other1",
		};
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		let calls = 0;
		const app = fakeApp({
			files,
			cachedRead: async (file) => {
				calls++;
				if (calls === 1) await gate; // hold the first (whole-vault) scan mid-flight
				return files[file.path as keyof typeof files];
			},
		});
		let folders: string[] = [];
		const index = new VocabIndex(app, () => folders);

		const oldScan = index.get();
		await tick();
		folders = ["Work"];
		index.invalidate();
		await index.get();
		release();
		await oldScan;
		await tick();

		const vocab = await index.get();
		expect(vocab.project.has("Work1")).toBe(true);
		expect(vocab.project.has("Other1")).toBe(false);
	});

	it("one unreadable file does not break completion for the rest", async () => {
		const files = { "a.md": "- [ ] x +A1", "b.md": "- [ ] y +B1" };
		const app = fakeApp({
			files,
			cachedRead: async (file) => {
				if (file.path === "a.md") throw new Error("file vanished");
				return files[file.path as keyof typeof files];
			},
		});
		const index = new VocabIndex(app, () => []);
		const vocab = await index.get();
		expect(vocab.project.get("B1")).toBe(1);
	});

	it("recovers after a failed scan instead of caching the failure", async () => {
		const files = { "a.md": "- [ ] x +A1" };
		let attempts = 0;
		const app = fakeApp({
			files,
			getMarkdownFiles: () => {
				attempts++;
				if (attempts === 1) throw new Error("vault not ready");
				return [makeFile("a.md")];
			},
		});
		const index = new VocabIndex(app, () => []);
		const first = await index.get();
		expect(first.project.size).toBe(0);
		const second = await index.get();
		expect(second.project.get("A1")).toBe(1);
	});

	it("uses the open note's live lines instead of its cached (autosaved) content", async () => {
		const files = { "Note.md": "- [ ] a +Finan", "Other.md": "- [ ] b +Finance" };
		const index = new VocabIndex(fakeApp({ files }), () => []);
		const vocab = await index.get({ path: "Note.md", lines: ["- [ ] a"] });
		expect(vocab.project.has("Finan")).toBe(false);
		expect(vocab.project.get("Finance")).toBe(1);
	});
});
