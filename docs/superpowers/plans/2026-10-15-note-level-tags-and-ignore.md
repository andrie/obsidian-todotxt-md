# Note-level tags and ignore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A note's `todotxt:` front matter can exclude the note from the aggregated view, or give every task in it inherited `+project` / `@context` tags that are never written to the task lines.

**Architecture:** A new pure module `src/noteMeta.ts` turns front matter into `NoteMeta`. `aggregate.ts` and `vocab.ts` (both pure) consume it. `view.ts` and `vocabIndex.ts` are thin glue that read front matter from the content they already read, via Obsidian's `parseYaml`.

**Tech Stack:** TypeScript (strict), vitest, Obsidian API (`parseYaml`), esbuild.

**Spec:** `docs/superpowers/specs/2026-10-15-note-level-tags-and-ignore-design.md`

## Global Constraints

- `parse.ts` is the only place task syntax is defined. No new task-syntax regex elsewhere. `noteMeta.ts` handles front matter only and reuses `ContextToken` from `parse.ts`.
- Pure core: `noteMeta.ts`, `aggregate.ts` and `vocab.ts` import nothing from `obsidian`. The YAML parser is injected.
- Inherited tags are virtual: never on `Task`, never written to a task line.
- No emojis in stored task text. No new settings.
- Bare context names get prefix `@`; explicit `#` is preserved. Projects are always shown as `+name`.
- Tab indentation, double quotes, semicolons (match existing files; `npm run lint` enforces prettier).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- A YAML number as a name (`projects: [2026]`) must become project `2026`, not be dropped. Pinned in Task 1.
- Duplicates inside the front matter (`projects: [a, "+a"]`) must collapse to one. Pinned in Task 1.
- Malformed YAML (parse throws) must mean "not ignored, no tags", never an exception that breaks the scan. Pinned in Task 1.
- A task that types `#home` in a note whose front matter says `contexts: [home]` must not also show an inherited `@home`. Pinned in Task 2.
- CRLF files and a front matter block with no closing `---` must not swallow the whole note as YAML. Pinned in Task 1.

---

### Task 1: `noteMeta.ts` (pure front matter parsing)

**Files:**
- Create: `src/noteMeta.ts`
- Test: `tests/noteMeta.test.ts`

**Interfaces:**
- Produces:
  - `interface NoteMeta { ignore: boolean; projects: string[]; contexts: ContextToken[] }`
  - `splitFrontmatter(content: string): string | null`
  - `parseNoteMeta(frontmatter: unknown): NoteMeta`
  - `readNoteMeta(content: string, parseYaml: (text: string) => unknown): NoteMeta`

- [ ] **Step 1: Write the failing tests**

Create `tests/noteMeta.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { splitFrontmatter, parseNoteMeta, readNoteMeta } from "../src/noteMeta";

describe("splitFrontmatter", () => {
	it("returns the text between the leading --- lines", () => {
		expect(splitFrontmatter("---\na: 1\nb: 2\n---\nbody")).toBe("a: 1\nb: 2");
	});

	it("returns null when the note does not start with ---", () => {
		expect(splitFrontmatter("body\n---\na: 1\n---")).toBeNull();
	});

	it("returns null when there is no closing ---", () => {
		expect(splitFrontmatter("---\na: 1\n- [ ] task")).toBeNull();
	});

	it("handles Windows line endings", () => {
		expect(splitFrontmatter("---\r\na: 1\r\n---\r\nbody")).toBe("a: 1");
	});

	it("tolerates a leading byte-order mark", () => {
		expect(splitFrontmatter("﻿---\na: 1\n---\n")).toBe("a: 1");
	});

	it("returns an empty string for an empty block", () => {
		expect(splitFrontmatter("---\n---\n")).toBe("");
	});
});

describe("parseNoteMeta", () => {
	const empty = { ignore: false, projects: [], contexts: [] };

	it("returns the empty default for non-objects and a missing or non-map todotxt key", () => {
		expect(parseNoteMeta(undefined)).toEqual(empty);
		expect(parseNoteMeta(null)).toEqual(empty);
		expect(parseNoteMeta("text")).toEqual(empty);
		expect(parseNoteMeta({})).toEqual(empty);
		expect(parseNoteMeta({ todotxt: "ignore" })).toEqual(empty);
		expect(parseNoteMeta({ todotxt: ["ignore"] })).toEqual(empty);
	});

	it("reads ignore: true and the string 'true' in any case", () => {
		expect(parseNoteMeta({ todotxt: { ignore: true } }).ignore).toBe(true);
		expect(parseNoteMeta({ todotxt: { ignore: "TRUE" } }).ignore).toBe(true);
		expect(parseNoteMeta({ todotxt: { ignore: " true " } }).ignore).toBe(true);
	});

	it("treats any other ignore value as false", () => {
		expect(parseNoteMeta({ todotxt: { ignore: false } }).ignore).toBe(false);
		expect(parseNoteMeta({ todotxt: { ignore: "yes" } }).ignore).toBe(false);
		expect(parseNoteMeta({ todotxt: { ignore: 1 } }).ignore).toBe(false);
	});

	it("strips an optional + from projects", () => {
		const meta = parseNoteMeta({ todotxt: { projects: ["alpha", "+beta"] } });
		expect(meta.projects).toEqual(["alpha", "beta"]);
	});

	it("gives bare contexts the @ prefix and keeps an explicit # or @", () => {
		const meta = parseNoteMeta({ todotxt: { contexts: ["home", "@work", "#errand"] } });
		expect(meta.contexts).toEqual([
			{ name: "home", prefix: "@" },
			{ name: "work", prefix: "@" },
			{ name: "errand", prefix: "#" },
		]);
	});

	it("accepts a single string instead of a list", () => {
		const meta = parseNoteMeta({ todotxt: { projects: "+solo", contexts: "home" } });
		expect(meta.projects).toEqual(["solo"]);
		expect(meta.contexts).toEqual([{ name: "home", prefix: "@" }]);
	});

	it("accepts YAML numbers as names", () => {
		const meta = parseNoteMeta({ todotxt: { projects: [2026], contexts: [42] } });
		expect(meta.projects).toEqual(["2026"]);
		expect(meta.contexts).toEqual([{ name: "42", prefix: "@" }]);
	});

	it("drops empty, whitespace-containing and non-scalar entries", () => {
		const meta = parseNoteMeta({
			todotxt: { projects: ["", "+", "two words", { a: 1 }, null, "ok"], contexts: ["@", " "] },
		});
		expect(meta.projects).toEqual(["ok"]);
		expect(meta.contexts).toEqual([]);
	});

	it("collapses duplicates", () => {
		const meta = parseNoteMeta({
			todotxt: { projects: ["a", "+a", "a"], contexts: ["x", "@x", "#x"] },
		});
		expect(meta.projects).toEqual(["a"]);
		expect(meta.contexts).toEqual([
			{ name: "x", prefix: "@" },
			{ name: "x", prefix: "#" },
		]);
	});

	it("ignores a non-list, non-string projects value", () => {
		expect(parseNoteMeta({ todotxt: { projects: { a: 1 } } }).projects).toEqual([]);
	});
});

describe("readNoteMeta", () => {
	const fakeYaml = (text: string): unknown => JSON.parse(text);

	it("parses the front matter block with the injected parser", () => {
		const content = '---\n{"todotxt": {"ignore": true}}\n---\n- [ ] task';
		expect(readNoteMeta(content, fakeYaml).ignore).toBe(true);
	});

	it("returns the empty default when there is no front matter", () => {
		expect(readNoteMeta("- [ ] task", fakeYaml)).toEqual({
			ignore: false,
			projects: [],
			contexts: [],
		});
	});

	it("returns the empty default (not ignored) when the parser throws", () => {
		const meta = readNoteMeta("---\nnot json\n---\n", fakeYaml);
		expect(meta).toEqual({ ignore: false, projects: [], contexts: [] });
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/noteMeta.test.ts`
Expected: FAIL, cannot resolve `../src/noteMeta`.

- [ ] **Step 3: Implement**

Create `src/noteMeta.ts`:

```ts
/**
 * Note-level metadata from the `todotxt:` front matter key (see the 2026-10-15 spec). Pure: the
 * YAML parser is injected, so this runs in plain Node. This module handles front matter, not task
 * syntax; the task grammar stays in parse.ts.
 */
import type { ContextToken } from "./parse";

export interface NoteMeta {
	/** The note is left out of the aggregated view and the inline-suggestion vocabulary. */
	ignore: boolean;
	/** Bare names, no `+`. */
	projects: string[];
	/** Prefix preserved; a name given without a sigil gets `@`. */
	contexts: ContextToken[];
}

function emptyMeta(): NoteMeta {
	return { ignore: false, projects: [], contexts: [] };
}

/** The YAML text between the leading `---` lines, or null when the note has no closed block. */
export function splitFrontmatter(content: string): string | null {
	const lines = content.replace(/^﻿/, "").split(/\r?\n/);
	if (lines[0]?.trimEnd() !== "---") return null;
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trimEnd();
		if (line === "---" || line === "...") return lines.slice(1, i).join("\n");
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A list or a single scalar becomes trimmed strings; anything else is dropped. */
function toNames(value: unknown): string[] {
	const items = Array.isArray(value) ? value : [value];
	const names: string[] = [];
	for (const item of items) {
		if (typeof item === "string") names.push(item.trim());
		else if (typeof item === "number") names.push(String(item));
	}
	return names;
}

/** Tokens are space-delimited in parse.ts, so a name with whitespace could never match. */
function isValidName(name: string): boolean {
	return name.length > 0 && !/\s/.test(name);
}

export function parseNoteMeta(frontmatter: unknown): NoteMeta {
	const meta = emptyMeta();
	if (!isRecord(frontmatter)) return meta;
	const section = frontmatter.todotxt;
	if (!isRecord(section)) return meta;

	const ignore = section.ignore;
	meta.ignore =
		ignore === true || (typeof ignore === "string" && ignore.trim().toLowerCase() === "true");

	for (const raw of toNames(section.projects)) {
		const name = raw.startsWith("+") ? raw.slice(1) : raw;
		if (isValidName(name) && !meta.projects.includes(name)) meta.projects.push(name);
	}

	for (const raw of toNames(section.contexts)) {
		const explicit = raw.startsWith("@") || raw.startsWith("#");
		const prefix = raw.startsWith("#") ? "#" : "@";
		const name = explicit ? raw.slice(1) : raw;
		if (!isValidName(name)) continue;
		if (!meta.contexts.some((c) => c.name === name && c.prefix === prefix)) {
			meta.contexts.push({ name, prefix });
		}
	}
	return meta;
}

/** Front matter of `content` as NoteMeta. Unparseable YAML means "no metadata", never a throw. */
export function readNoteMeta(content: string, parseYaml: (text: string) => unknown): NoteMeta {
	const block = splitFrontmatter(content);
	if (block === null) return emptyMeta();
	try {
		return parseNoteMeta(parseYaml(block));
	} catch {
		return emptyMeta();
	}
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/noteMeta.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/noteMeta.ts tests/noteMeta.test.ts
git commit -m "feat: parse todotxt front matter into NoteMeta"
```

---

### Task 2: Inherited tags in `aggregate.ts`

**Files:**
- Modify: `src/aggregate.ts`
- Modify: `tests/aggregate.test.ts` (the `record()` helper and new tests)

**Interfaces:**
- Consumes: `NoteMeta` from Task 1 (only `projects` and `contexts` are used).
- Produces:
  - `interface InheritedTags { projects: string[]; contexts: ContextToken[] }`
  - `inheritedFor(task: Task, meta: Pick<NoteMeta, "projects" | "contexts">): InheritedTags`
  - `TaskRecord.inherited: InheritedTags` (required field)

- [ ] **Step 1: Write the failing tests**

In `tests/aggregate.test.ts`, change the import and helper, then add tests.

Replace the import block's `aggregate` import to add `inheritedFor` and `type InheritedTags`:

```ts
import {
	aggregateTasks,
	inheritedFor,
	matchesDueWindow,
	DEFAULT_FILTER,
	type AggregateFilter,
	type InheritedTags,
	type TaskRecord,
} from "../src/aggregate";
```

Replace the `record()` helper:

```ts
function record(
	raw: string,
	filePath = "Work.md",
	line = 0,
	inherited: InheritedTags = { projects: [], contexts: [] },
): TaskRecord {
	const task = parseTaskLine(raw);
	if (!task) throw new Error("fixture line did not parse");
	return { task, filePath, line, inherited };
}
```

Append at the end of the file:

```ts
describe("inheritedFor", () => {
	const meta = {
		projects: ["Home", "Garden"],
		contexts: [
			{ name: "place", prefix: "@" as const },
			{ name: "errand", prefix: "#" as const },
		],
	};

	it("returns all note tags for a task with none typed", () => {
		const task = parseTaskLine("- [ ] water plants")!;
		expect(inheritedFor(task, meta)).toEqual(meta);
	});

	it("omits projects the task already typed", () => {
		const task = parseTaskLine("- [ ] water plants +Garden")!;
		expect(inheritedFor(task, meta).projects).toEqual(["Home"]);
	});

	it("omits a context the task typed under either prefix", () => {
		const task = parseTaskLine("- [ ] buy milk #place @errand")!;
		expect(inheritedFor(task, meta).contexts).toEqual([]);
	});
});

describe("aggregateTasks with inherited tags", () => {
	const inherited: InheritedTags = {
		projects: ["Home"],
		contexts: [{ name: "place", prefix: "@" }],
	};

	it("project filter matches an inherited project", () => {
		const records = [record("- [ ] a", "n.md", 0, inherited), record("- [ ] b")];
		const result = aggregateTasks(records, { ...DEFAULT_FILTER, projects: ["Home"] }, fixedClock);
		expect(result.map((r) => r.task.description)).toEqual(["a"]);
	});

	it("context filter matches an inherited context by name", () => {
		const records = [record("- [ ] a", "n.md", 0, inherited), record("- [ ] b")];
		const result = aggregateTasks(records, { ...DEFAULT_FILTER, contexts: ["place"] }, fixedClock);
		expect(result.map((r) => r.task.description)).toEqual(["a"]);
	});

	it("AND semantics span typed and inherited tags", () => {
		const records = [
			record("- [ ] a +Work", "n.md", 0, inherited),
			record("- [ ] b +Work"),
			record("- [ ] c", "n.md", 2, inherited),
		];
		const result = aggregateTasks(
			records,
			{ ...DEFAULT_FILTER, projects: ["Home", "Work"] },
			fixedClock,
		);
		expect(result.map((r) => r.task.description)).toEqual(["a"]);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/aggregate.test.ts`
Expected: FAIL (`inheritedFor` is not exported; inherited filters do not match).

- [ ] **Step 3: Implement**

In `src/aggregate.ts`, change the imports and `TaskRecord`:

```ts
import type { ContextToken, Task } from "./parse";
import { compareTasks } from "./sort";
import type { Clock } from "./dates";
import type { NoteMeta } from "./noteMeta";

/**
 * Tags a note's front matter gives its tasks. Kept off `Task` on purpose: they are virtual, so
 * write-back (which re-serialises the parsed line) can never persist them.
 */
export interface InheritedTags {
	projects: string[];
	contexts: ContextToken[];
}

export interface TaskRecord {
	task: Task;
	filePath: string;
	/** 0-indexed line number, matching Editor.setCursor's line convention. */
	line: number;
	inherited: InheritedTags;
}
```

(Keep the existing doc comment above `TaskRecord`; place `InheritedTags` before it.) Add after `TaskRecord`:

```ts
/**
 * The note's tags minus any the task already typed. Contexts match by name regardless of prefix
 * (filtering is prefix-blind), so a typed `#home` suppresses an inherited `@home`.
 */
export function inheritedFor(
	task: Task,
	meta: Pick<NoteMeta, "projects" | "contexts">,
): InheritedTags {
	return {
		projects: meta.projects.filter((p) => !task.projects.includes(p)),
		contexts: meta.contexts.filter((c) => !task.contexts.some((t) => t.name === c.name)),
	};
}
```

Replace the filter body in `aggregateTasks`:

```ts
	const filtered = records.filter(({ task, inherited }) => {
		if (!filter.includeDone && task.done) return false;
		const contextNames = [...task.contexts, ...inherited.contexts].map((c) => c.name);
		if (filter.contexts.some((c) => !contextNames.includes(c))) return false;
		const projects = [...task.projects, ...inherited.projects];
		if (filter.projects.some((p) => !projects.includes(p))) return false;
		if (!matchesDueWindow(task.due, filter.dueWindow, clock)) return false;
		return true;
	});
```

Also update the doc comments on `AggregateFilter.contexts`/`projects` to say "typed or inherited".

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/aggregate.test.ts`
Expected: PASS. (`view.ts` will not type-check until Task 4; that is expected. Do not run `npm run build` yet.)

- [ ] **Step 5: Commit**

```bash
git add src/aggregate.ts tests/aggregate.test.ts
git commit -m "feat: filter the aggregated view by inherited note tags"
```

---

### Task 3: `extractNoteVocab` in `vocab.ts`

**Files:**
- Modify: `src/vocab.ts`
- Modify: `tests/vocab.test.ts`

**Interfaces:**
- Consumes: `NoteMeta` from Task 1.
- Produces: `extractNoteVocab(meta: NoteMeta, lines: string[]): FileVocab`

- [ ] **Step 1: Write the failing tests**

Append to `tests/vocab.test.ts` (add `extractNoteVocab` to its existing `../src/vocab` import, and add `import type { NoteMeta } from "../src/noteMeta";`):

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/vocab.test.ts`
Expected: FAIL (`extractNoteVocab` is not a function).

- [ ] **Step 3: Implement**

In `src/vocab.ts` add the import `import type { NoteMeta } from "./noteMeta";` and, after `extractFileVocab`:

```ts
/**
 * A note's vocabulary: nothing when the note is ignored, otherwise its tasks' names plus the
 * names its front matter declares (so `+Home` is suggestable before any task line uses it).
 */
export function extractNoteVocab(meta: NoteMeta, lines: string[]): FileVocab {
	if (meta.ignore) return emptyVocab();
	const vocab = extractFileVocab(lines);
	for (const project of meta.projects) bump(vocab.project, project);
	for (const context of meta.contexts) {
		bump(context.prefix === "@" ? vocab.at : vocab.hash, context.name);
	}
	return vocab;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/vocab.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/vocab.ts tests/vocab.test.ts
git commit -m "feat: build suggestion vocabulary from note front matter"
```

---

### Task 4: Wire the index, the view and the styles

**Files:**
- Modify: `tests/stubs/obsidian.ts` (add a small `parseYaml`)
- Modify: `src/vocabIndex.ts`
- Modify: `tests/vocabIndex.test.ts`
- Modify: `src/view.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `readNoteMeta` (Task 1), `inheritedFor` / `TaskRecord.inherited` (Task 2), `extractNoteVocab` (Task 3).
- Produces: nothing new for other tasks.

- [ ] **Step 1: Add `parseYaml` to the obsidian stub**

Append to `tests/stubs/obsidian.ts`:

```ts
/**
 * Stand-in for Obsidian's parseYaml, covering only the front matter shapes the tests use: a
 * top-level key, one nested map beneath it, `key: scalar`, and `key: [a, b]` flow lists.
 */
export function parseYaml(text: string): unknown {
	const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");
	const scalar = (value: string): unknown => {
		if (value.startsWith("[")) {
			return value
				.slice(1, -1)
				.split(",")
				.map(unquote)
				.filter((s) => s.length > 0);
		}
		if (value === "true") return true;
		if (value === "false") return false;
		return unquote(value);
	};
	const root: Record<string, unknown> = {};
	let section: Record<string, unknown> | null = null;
	for (const raw of text.split("\n")) {
		const match = /^(\s*)([\w-]+):\s*(.*)$/.exec(raw);
		if (!match) continue;
		const [, indent, key, value] = match;
		const target = indent ? section : root;
		if (!target) continue;
		if (value === "") {
			const child: Record<string, unknown> = {};
			target[key] = child;
			if (!indent) section = child;
		} else {
			target[key] = scalar(value);
		}
	}
	return root;
}
```

- [ ] **Step 2: Write the failing index tests**

Append inside the `describe("VocabIndex", ...)` block of `tests/vocabIndex.test.ts`:

```ts
	it("an ignored note contributes no names", async () => {
		const app = fakeApp({
			files: {
				"shop.md": "---\ntodotxt:\n  ignore: true\n---\n- [ ] milk +Groceries",
				"a.md": "- [ ] x +Work1",
			},
		});
		const index = new VocabIndex(app, () => []);
		const vocab = await index.get();
		expect(vocab.project.has("Groceries")).toBe(false);
		expect(vocab.project.has("Work1")).toBe(true);
	});

	it("a note's declared projects and contexts become vocabulary", async () => {
		const app = fakeApp({
			files: {
				"proj.md":
					"---\ntodotxt:\n  projects: [Home]\n  contexts: [garage]\n---\n- [ ] sweep",
			},
		});
		const index = new VocabIndex(app, () => []);
		const vocab = await index.get();
		expect(vocab.project.get("Home")).toBe(1);
		expect(vocab.at.get("garage")).toBe(1);
	});

	it("the open note's live front matter replaces its cached entry", async () => {
		const app = fakeApp({ files: { "n.md": "- [ ] x +Cached" } });
		const index = new VocabIndex(app, () => []);
		const vocab = await index.get({
			path: "n.md",
			lines: ["---", "todotxt:", "  ignore: true", "---", "- [ ] x +Cached"],
		});
		expect(vocab.project.has("Cached")).toBe(false);
	});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/vocabIndex.test.ts`
Expected: the three new tests FAIL; existing ones still pass.

- [ ] **Step 4: Implement `vocabIndex.ts`**

Change the imports at the top:

```ts
import { App, Plugin, TAbstractFile, TFile, debounce, parseYaml } from "obsidian";
import {
	adjustVocab,
	extractNoteVocab,
	mergeVocab,
	isInScanFolders,
	type FileVocab,
} from "./vocab";
import { readNoteMeta } from "./noteMeta";
```

In `get`, replace the last line:

```ts
		const live = extractNoteVocab(readNoteMeta(active.lines.join("\n"), parseYaml), active.lines);
		return adjustVocab(this.merged, this.perFile.get(active.path), live);
```

In `index`, replace the `perFile.set` line:

```ts
		const lines = content.split("\n");
		this.perFile.set(file.path, extractNoteVocab(readNoteMeta(content, parseYaml), lines));
```

- [ ] **Step 5: Implement `view.ts`**

Change imports:

```ts
import { ItemView, WorkspaceLeaf, TFile, debounce, parseYaml, type Editor } from "obsidian";
import type TodotxtMdPlugin from "./main";
import { parseTaskLine, serializeTask } from "./parse";
import { toggleDone } from "./editor";
import {
	aggregateTasks,
	inheritedFor,
	DEFAULT_FILTER,
	type AggregateFilter,
	type TaskRecord,
} from "./aggregate";
import { readNoteMeta } from "./noteMeta";
```

In `scanVault`, replace the loop body:

```ts
		for (const file of scopedFiles) {
			const content = await this.app.vault.cachedRead(file);
			const meta = readNoteMeta(content, parseYaml);
			if (meta.ignore) continue;
			const lines = content.split("\n");
			lines.forEach((lineText, index) => {
				const task = parseTaskLine(lineText);
				if (task) {
					records.push({
						task,
						filePath: file.path,
						line: index,
						inherited: inheritedFor(task, meta),
					});
				}
			});
		}
```

In `renderTaskRow`, replace the `if (this.plugin.settings.enableAggregatedViewPills) { ... } else { ... }` block (lines 141-173) with a version that walks typed then inherited tags. Typed first; each entry carries an `inherited` flag:

```ts
		const projects = [
			...task.projects.map((name) => ({ name, inherited: false })),
			...record.inherited.projects.map((name) => ({ name, inherited: true })),
		];
		const contexts = [
			...task.contexts.map((c) => ({ ...c, inherited: false })),
			...record.inherited.contexts.map((c) => ({ ...c, inherited: true })),
		];

		if (this.plugin.settings.enableAggregatedViewPills) {
			for (const project of projects) {
				container.appendText(" ");
				const pill = container.createSpan({
					text: `+${project.name}`,
					cls: "todotxt-md-pill todotxt-md-pill-project",
				});
				if (project.inherited) pill.addClass("todotxt-md-pill-inherited");
				pill.style.backgroundColor = nameToColor(project.name);
				pill.addEventListener("click", (evt) => {
					evt.stopPropagation();
					this.toggleProjectFilter(project.name);
				});
			}
			for (const context of contexts) {
				container.appendText(" ");
				const pill = container.createSpan({
					text: `${context.prefix}${context.name}`,
					cls: "todotxt-md-pill todotxt-md-pill-context",
				});
				if (context.inherited) pill.addClass("todotxt-md-pill-inherited");
				pill.style.backgroundColor = nameToColor(context.name);
				pill.addEventListener("click", (evt) => {
					evt.stopPropagation();
					this.toggleContextFilter(context.name);
				});
			}
		} else {
			for (const project of projects) container.appendText(` +${project.name}`);
			for (const context of contexts) container.appendText(` ${context.prefix}${context.name}`);
		}
```

`toggleRecordDone` needs no change: it re-parses the line from disk and keeps the same `record` object, so `record.inherited` survives.

- [ ] **Step 6: Style**

In `styles.css`, directly after the `.todotxt-md-pill { ... }` rule, add:

```css
/* A tag the note's front matter gives the task, not one typed on the line. */
.todotxt-md-pill-inherited {
	opacity: 0.55;
}
```

- [ ] **Step 7: Verify everything**

Run: `npm test`
Expected: all test files PASS.

Run: `npm run build`
Expected: no TypeScript errors; `main.js` rebuilt.

Run: `npm run lint`
Expected: clean. If prettier complains, run `npx prettier --write src tests styles.css` and re-run.

- [ ] **Step 8: Commit**

```bash
git add src/vocabIndex.ts src/view.ts styles.css tests/stubs/obsidian.ts tests/vocabIndex.test.ts
git commit -m "feat: apply note-level ignore and inherited tags in the view and index"
```

---

### Task 5: Documentation and live check

**Files:**
- Modify: `README.md`, `SPEC.md`, `DECISIONS.md`
- Modify: `docs/superpowers/specs/2026-10-15-note-level-tags-and-ignore-design.md` (one table row)

- [ ] **Step 1: Update the spec table**

In the parsing table, change the dropped-entries row to:

`| empty, whitespace-containing or non-scalar entries | dropped silently |`

and add a row above it: `| YAML number (`projects: [2026]`) | name `"2026"` |`. Also add to the same table: `| unparseable YAML | empty default |`.

- [ ] **Step 2: README**

Add a "Note-level settings" section after the aggregated view section, with the YAML shape from the spec, a shopping-list `ignore: true` example, a project-note `projects`/`contexts` example, and the line "Inherited tags are shown muted in the aggregated view and are never written into your task lines."

- [ ] **Step 3: SPEC.md**

Under the aggregated view, add a short "Note-level metadata" subsection: the `todotxt:` key, `ignore`, `projects`, `contexts`, virtual tags, vocab behaviour.

- [ ] **Step 4: DECISIONS.md**

Add an entry dated 2026-10-15: "Inherited tags are virtual, never persisted". Decision: apply at read time, keep off `Task`. Rejected alternatives: reading `metadataCache` (lags behind `modify`), a flat `todotxt: +x, @y` value (unquoted `@` is invalid YAML), writing tags into task lines (violates plain-text rule, breaks removal), glob exclusion (deferred).

- [ ] **Step 5: Live check in the test vault**

Run: `npm run dev:copy` (copies the build into the sibling `test` vault, per the memory note; do not ask for the path). In Obsidian, reload the plugin and confirm:

1. A note with `todotxt:\n  ignore: true` and a task line is absent from the aggregated view, and its `+names` are absent from the inline `+` popup.
2. A note with `todotxt:\n  projects: [Home]\n  contexts: [garage]` and plain `- [ ]` tasks shows those tasks with muted `+Home` and `@garage` pills; clicking a pill filters; a task that also types `+Home` shows it once, not muted.
3. Ticking a task in the view changes only the checkbox (and adds the completion date) in the note; no `+Home`/`@garage` appears in the file.
4. Editing the front matter (flip `ignore`) refreshes the view within about a second.
5. A note whose front matter has a YAML error does not break the view; its tasks show without inherited tags.
6. Interop guard: `#tag` indexing in the tag pane and a Dataview `TASK` query still list the tasks.

- [ ] **Step 6: Final check and commit**

Run: `npm test && npm run build && npm run lint`
Expected: all green.

```bash
git add README.md SPEC.md DECISIONS.md docs/superpowers/specs/2026-10-15-note-level-tags-and-ignore-design.md
git commit -m "docs: document note-level ignore and inherited tags"
```
