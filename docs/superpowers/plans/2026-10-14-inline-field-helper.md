# Inline Field Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a discoverable inline popup that helps enter todo.txt fields on a task line by tapping (field menu after a space, `+project` / `@place` completion, `!` priority sub-list), chaining into the existing date popup.

**Architecture:** Three new pure, unit-tested modules (`vocab.ts`, `triggers.ts`, `suggestFields.ts`) hold all decisions: what to vocabulary-rank, which trigger fired, which fields to offer, and the exact text edits (as offset-based `TextEdit` plans). Thin Obsidian glue (`vocabIndex.ts`, `taskSuggest.ts`, `main.ts`) scans the vault for names, feeds one `EditorSuggest`, and applies the planned edits. Chaining works the way the Tasks plugin's does: a menu row inserts transient trigger text (`due:`, `+`, `@`, `#`, `!`) and the next popup fires on that edit.

**Tech Stack:** TypeScript (strict), Obsidian plugin API (`EditorSuggest`, `Vault` events), Vitest, esbuild.

**Spec:** `docs/superpowers/specs/2026-10-14-inline-field-helper-design.md` (see Task 5 for three amendments this plan makes to it).

## Global Constraints

- Plain text is the product: no emojis in stored task text, ever; nothing persisted that isn't plain todo.txt.
- `src/parse.ts` is the single source of truth for the grammar. No new task-syntax regexes outside it. (Trigger-syntax regexes for transient popup input such as `!`, `:`, `+`, `@` are not task grammar and live in `triggers.ts`, as they did in `dateSuggest.ts`.)
- Pure core: `vocab.ts`, `triggers.ts`, `suggestFields.ts` import nothing from `obsidian`. Never call `new Date()` in core logic; take an injected `Clock`.
- Contexts are `#tag` or `@context`, both first-class; each token's prefix is preserved and never rewritten.
- Human date shortcuts (`tod`, `tom`, `+3d`) are input-only and never persisted.
- Code style: tabs, double quotes, strict TypeScript, `@typescript-eslint/no-explicit-any` is an error in pure modules.
- Build on Windows with PowerShell/Node, not WSL.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

Failure modes the spec implies that no feature test would otherwise pin, most likely first:

1. **Enter right after a typed space** selects the first menu row instead of inserting a newline (Obsidian's popup owns Enter). Expected: user can Esc or turn the field menu off; the menu never appears on an empty body. Pinned by Task 2's "no menu on empty body" test and Task 4's live check.
2. **Priority on a done task** must land after the completion date, not before it. Pinned in Task 3.
3. **Indented/nested checkboxes** (`  - [ ] ...`) must trigger and edit at the right offsets. Pinned in Tasks 2 and 3.
4. **The token being typed offered back to itself** (autosave writes `+Fin` to disk, then the vocabulary contains `Fin`). Pinned in Task 1.
5. **Prose and non-task lines** containing `+`, `@`, `!` or `due:` never open a popup (including `a@b.com` and `#due:tod`). Pinned in Task 2.

---

### Task 1: Vocabulary core (`src/vocab.ts`)

**Files:**
- Create: `src/vocab.ts`
- Test: `tests/vocab.test.ts`

**Interfaces:**
- Consumes: `parseTaskLine` from `src/parse.ts`.
- Produces (used by Tasks 3 and 4):
  - `type VocabKind = "project" | "at" | "hash"`
  - `type CountMap = Map<string, number>`
  - `type FileVocab = Record<VocabKind, CountMap>`
  - `interface VocabEntry { name: string; count: number }`
  - `extractFileVocab(lines: string[]): FileVocab`
  - `mergeVocab(files: Iterable<FileVocab>): FileVocab`
  - `rankVocab(counts: CountMap, query: string, limit: number): VocabEntry[]`
  - `isInScanFolders(path: string, folders: string[]): boolean`

- [ ] **Step 1: Create the feature branch**

Run: `git checkout -b feat/inline-field-helper`
Expected: `Switched to a new branch 'feat/inline-field-helper'`

- [ ] **Step 2: Write the failing tests**

Create `tests/vocab.test.ts`:

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/vocab.test.ts`
Expected: FAIL (cannot resolve `../src/vocab`).

- [ ] **Step 4: Write the implementation**

Create `src/vocab.ts`:

```ts
/**
 * Vocabulary of names already used in the vault's tasks (+projects, @places, #tags), for the
 * inline +/@ completion popup. Pure: callers pass lines in, so this runs in plain Node. Uses
 * parseTaskLine for all recognition — no task-syntax regexes here (DESIGN_RULES.md: parse.ts
 * owns the grammar).
 */
import { parseTaskLine } from "./parse";

export type VocabKind = "project" | "at" | "hash";
export type CountMap = Map<string, number>;
export type FileVocab = Record<VocabKind, CountMap>;

export interface VocabEntry {
	name: string;
	count: number;
}

const KINDS: VocabKind[] = ["project", "at", "hash"];

function emptyVocab(): FileVocab {
	return { project: new Map(), at: new Map(), hash: new Map() };
}

function bump(map: CountMap, name: string, by = 1): void {
	map.set(name, (map.get(name) ?? 0) + by);
}

/** Counts the names used by the checkbox tasks among `lines`. Non-task lines are ignored. */
export function extractFileVocab(lines: string[]): FileVocab {
	const vocab = emptyVocab();
	for (const line of lines) {
		const task = parseTaskLine(line);
		if (!task) continue;
		for (const project of task.projects) bump(vocab.project, project);
		for (const context of task.contexts) {
			bump(context.prefix === "@" ? vocab.at : vocab.hash, context.name);
		}
	}
	return vocab;
}

export function mergeVocab(files: Iterable<FileVocab>): FileVocab {
	const merged = emptyVocab();
	for (const file of files) {
		for (const kind of KINDS) {
			for (const [name, count] of file[kind]) bump(merged[kind], name, count);
		}
	}
	return merged;
}

/**
 * Names whose lowercase form starts with `query`, most-used first (ties alphabetical), capped at
 * `limit`. An exact match used only once is dropped: that is almost certainly the token the user
 * is typing right now, which autosave has already written to disk.
 */
export function rankVocab(counts: CountMap, query: string, limit: number): VocabEntry[] {
	const lowerQuery = query.toLowerCase();
	return [...counts]
		.filter(
			([name, count]) =>
				name.toLowerCase().startsWith(lowerQuery) && !(name === query && count === 1),
		)
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
		.slice(0, limit);
}

/** Same folder-scoping rule as the aggregated view's `scanFolders` setting; empty = whole vault. */
export function isInScanFolders(path: string, folders: string[]): boolean {
	return (
		folders.length === 0 || folders.some((folder) => path === folder || path.startsWith(folder + "/"))
	);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/vocab.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add src/vocab.ts tests/vocab.test.ts
git commit -m "feat: add pure vocabulary core for inline +/@ completion" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Trigger detection (`src/triggers.ts`)

Moves the trigger logic out of `dateSuggest.ts` into a pure, tested module and adds the new triggers.

**Files:**
- Create: `src/triggers.ts`
- Test: `tests/triggers.test.ts`

**Interfaces:**
- Consumes: `parseTaskLine`, `checkboxBodyStart` from `src/parse.ts`.
- Produces (used by Tasks 3 and 4):
  - `type TriggerKind = "date" | "priority" | "project" | "at" | "field"`
  - `interface TriggerMatch { kind: TriggerKind; start: number; end: number; query: string }` — `[start, end)` are line offsets of the span replaced on selection; `query` is the text typed after the trigger symbol.
  - `detectTrigger(line: string, ch: number, opts: { fieldMenu: boolean }): TriggerMatch | null`

Trigger rules (all require a checkbox line and `ch >= bodyStart`; first match wins in this order):

| # | Kind | Matches (text before cursor) | `start` |
|---|------|------------------------------|---------|
| 1 | `date` | body is `[(X) ]:query` (leading bare colon) | the `:` |
| 2 | `date` | `due:query` / `t:query` after whitespace or line start | `ch - query.length` |
| 3 | `priority` | `!query` (letters) after whitespace/body start, **only if the task has no priority** | the `!` |
| 4 | `project` / `at` | `+query` / `@query` after whitespace/body start | the symbol |
| 5 | `field` | body ends with exactly one space after a non-space char (setting on) | `ch` (empty span) |

- [ ] **Step 1: Write the failing tests**

Create `tests/triggers.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/triggers.test.ts`
Expected: FAIL (cannot resolve `../src/triggers`).

- [ ] **Step 3: Write the implementation**

Create `src/triggers.ts`:

```ts
/**
 * Decides which inline popup (if any) the cursor position should open. Pure: takes the line
 * text and cursor offset, returns what fired and which span a selection replaces. The regexes
 * below match transient *popup input* (":", "due:", "!", "+", "@"), not stored task grammar —
 * recognising tasks and the checkbox prefix stays in parse.ts. Every trigger requires the
 * boundary the parser itself enforces (line start or preceding whitespace): substring matches
 * misfire on `#due:` and similar (SPEC.md, 2026-09-20 lesson), and a replacement span that
 * covers more than the typed query eats adjacent tokens (2026-10-04 lesson).
 */
import { parseTaskLine, checkboxBodyStart } from "./parse";

export type TriggerKind = "date" | "priority" | "project" | "at" | "field";

export interface TriggerMatch {
	kind: TriggerKind;
	/** Line offsets; [start, end) is replaced on selection. */
	start: number;
	end: number;
	/** Text typed after the trigger symbol (empty for the field menu). */
	query: string;
}

export interface TriggerOptions {
	fieldMenu: boolean;
}

const DATE_TRIGGER_RE = /(?:^|\s)(?:due|t):([A-Za-z0-9+]*)$/;
/** Bare ":" right after the checkbox or after a "(X) " priority token; never persisted. */
const LEADING_DATE_TRIGGER_RE = /^(?:\([A-Za-z]\)\s+)?:([A-Za-z0-9+]*)$/;
/** Transient "!" opens the A-E priority sub-list; consumed on selection, never persisted. */
const PRIORITY_TRIGGER_RE = /(?:^|\s)!([A-Za-z]*)$/;
const VOCAB_TRIGGER_RE = /(?:^|\s)([+@])([^\s]*)$/;

export function detectTrigger(
	line: string,
	ch: number,
	options: TriggerOptions,
): TriggerMatch | null {
	const task = parseTaskLine(line);
	if (!task) return null;

	const bodyStart = checkboxBodyStart(line);
	if (bodyStart === null || ch < bodyStart) return null;

	const beforeCursor = line.slice(0, ch);
	const body = line.slice(bodyStart, ch);

	const leading = LEADING_DATE_TRIGGER_RE.exec(body);
	if (leading) {
		const query = leading[1];
		// The span starts at the ":" itself; the optional "(X) " prefix only confirms leading
		// position and must survive the replacement.
		return { kind: "date", start: ch - 1 - query.length, end: ch, query };
	}

	const date = DATE_TRIGGER_RE.exec(beforeCursor);
	if (date) {
		const query = date[1];
		return { kind: "date", start: ch - query.length, end: ch, query };
	}

	if (task.priority === null) {
		const priority = PRIORITY_TRIGGER_RE.exec(body);
		if (priority) {
			const query = priority[1];
			return { kind: "priority", start: ch - 1 - query.length, end: ch, query };
		}
	}

	const vocab = VOCAB_TRIGGER_RE.exec(body);
	if (vocab) {
		const query = vocab[2];
		return {
			kind: vocab[1] === "+" ? "project" : "at",
			start: ch - 1 - query.length,
			end: ch,
			query,
		};
	}

	if (options.fieldMenu && body.length >= 2 && body.endsWith(" ") && !/\s/.test(body[body.length - 2])) {
		return { kind: "field", start: ch, end: ch, query: "" };
	}

	return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/triggers.test.ts`
Expected: PASS (all tests). If `"- [ ] c++"` unexpectedly fires, check that `VOCAB_TRIGGER_RE` still requires whitespace/start before the symbol.

- [ ] **Step 5: Commit**

```bash
git add src/triggers.ts tests/triggers.test.ts
git commit -m "feat: add pure trigger detection with !, +, @ and field-menu triggers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Field suggestions and edit plans (`src/suggestFields.ts`)

**Files:**
- Create: `src/suggestFields.ts`
- Test: `tests/suggestFields.test.ts`

**Interfaces:**
- Consumes: `parseTaskLine`, `parseTaskLineWithSpans`, `checkboxBodyStart` from `src/parse.ts`; `expandDateToken`, `Clock` from `src/dates.ts`.
- Produces (used by Task 4):
  - `type FieldKind = "priority" | "created" | "due" | "threshold" | "project" | "at" | "hash"`
  - `interface FieldSuggestion { kind: FieldKind; label: string; hint: string }`
  - `suggestFields(line: string, clock: Clock): FieldSuggestion[]`
  - `interface TextEdit { from: number; to: number; insert: string }` (line offsets, against the *original* line, ascending by `from`)
  - `interface EditPlan { edits: TextEdit[]; cursor: number }` (`cursor` is the offset in the *new* line)
  - `interface Span { start: number; end: number }`
  - `planReplace(span: Span, insert: string): EditPlan`
  - `planFieldEdit(line: string, ch: number, kind: FieldKind, clock: Clock): EditPlan | null`
  - `planPriorityEdit(line: string, span: Span, letter: string): EditPlan | null`
  - `editsDescending(plan: EditPlan): TextEdit[]` (the order in which to apply edits so earlier offsets stay valid)
  - `applyEditPlan(line: string, plan: EditPlan): string` (pure application, used by tests)

- [ ] **Step 1: Write the failing tests**

Create `tests/suggestFields.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/suggestFields.test.ts`
Expected: FAIL (cannot resolve `../src/suggestFields`).

- [ ] **Step 3: Write the implementation**

Create `src/suggestFields.ts`:

```ts
/**
 * Field-menu suggestions and the exact text edits that selecting them performs. Pure: all
 * decisions are made against the parsed task (parse.ts) and returned as offset-based edit
 * plans, so the Obsidian glue only has to apply them. Edits are local insertions — the line is
 * never re-serialised — so tokens the user is mid-way through typing are never reordered.
 */
import { parseTaskLine, parseTaskLineWithSpans, checkboxBodyStart, type TokenSpan } from "./parse";
import { expandDateToken, type Clock } from "./dates";

export type FieldKind = "priority" | "created" | "due" | "threshold" | "project" | "at" | "hash";

export interface FieldSuggestion {
	kind: FieldKind;
	label: string;
	hint: string;
}

export interface Span {
	start: number;
	end: number;
}

/** Offsets are against the original line; edits in a plan are ascending by `from`. */
export interface TextEdit {
	from: number;
	to: number;
	insert: string;
}

export interface EditPlan {
	edits: TextEdit[];
	/** Cursor offset in the line *after* all edits are applied. */
	cursor: number;
}

const TRANSIENT_TEXT: Partial<Record<FieldKind, string>> = {
	priority: "!",
	due: "due:",
	threshold: "t:",
	project: "+",
	at: "@",
	hash: "#",
};

export function suggestFields(line: string, clock: Clock): FieldSuggestion[] {
	const task = parseTaskLine(line);
	if (!task) return [];

	const today = expandDateToken("tod", clock) ?? "";
	const rows: Array<FieldSuggestion & { show: boolean }> = [
		{ kind: "priority", label: "Priority", hint: "(A)-(E)", show: task.priority === null },
		{
			kind: "created",
			label: "Created",
			hint: today,
			show: !task.done && task.creationDate === null,
		},
		{ kind: "due", label: "due:", hint: "due date", show: task.due === null },
		{ kind: "threshold", label: "t:", hint: "start date", show: task.threshold === null },
		{ kind: "project", label: "+", hint: "project", show: true },
		{ kind: "at", label: "@", hint: "place / context", show: true },
		{ kind: "hash", label: "#", hint: "tag / context", show: true },
	];
	return rows.filter((row) => row.show).map(({ kind, label, hint }) => ({ kind, label, hint }));
}

/** Maps a pre-edit offset to its position after applying `edits` (ascending by `from`). */
function mapCursor(offset: number, edits: TextEdit[]): number {
	let result = offset;
	for (const edit of edits) {
		if (edit.to <= offset) result += edit.insert.length - (edit.to - edit.from);
	}
	return result;
}

export function planReplace(span: Span, insert: string): EditPlan {
	return {
		edits: [{ from: span.start, to: span.end, insert }],
		cursor: span.start + insert.length,
	};
}

/** Order in which to apply edits so earlier offsets are not invalidated by later ones. */
export function editsDescending(plan: EditPlan): TextEdit[] {
	return [...plan.edits].sort((a, b) => b.from - a.from || b.to - a.to);
}

export function applyEditPlan(line: string, plan: EditPlan): string {
	let result = line;
	for (const edit of editsDescending(plan)) {
		result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
	}
	return result;
}

/** Offset where a priority token belongs: after a completion date if present, else body start. */
function priorityOffset(line: string, spans: TokenSpan[], bodyStart: number): number {
	const completion = spans.find((span) => span.kind === "completionDate");
	return completion ? Math.min(completion.end + 1, line.length) : bodyStart;
}

function createdEdit(line: string, spans: TokenSpan[], bodyStart: number, iso: string): TextEdit {
	const priority = spans.find((span) => span.kind === "priority");
	if (!priority) {
		const at = priorityOffset(line, spans, bodyStart);
		return { from: at, to: at, insert: `${iso} ` };
	}
	if (line[priority.end] === " ") {
		return { from: priority.end + 1, to: priority.end + 1, insert: `${iso} ` };
	}
	return { from: priority.end, to: priority.end, insert: ` ${iso} ` };
}

/**
 * Plan for selecting a field-menu row with the cursor at `ch`. Most rows insert transient
 * trigger text at the cursor so the next popup fires (due: -> date popup, + -> project popup,
 * ! -> priority sub-list). "created" inserts today's date directly in the leading slot.
 */
export function planFieldEdit(
	line: string,
	ch: number,
	kind: FieldKind,
	clock: Clock,
): EditPlan | null {
	const parsed = parseTaskLineWithSpans(line);
	const bodyStart = checkboxBodyStart(line);
	if (!parsed || bodyStart === null) return null;

	if (kind === "created") {
		const iso = expandDateToken("tod", clock);
		if (!iso || parsed.task.done || parsed.task.creationDate !== null) return null;
		const edits = [createdEdit(line, parsed.spans, bodyStart, iso)];
		return { edits, cursor: mapCursor(ch, edits) };
	}

	const text = TRANSIENT_TEXT[kind];
	if (text === undefined) return null;
	return { edits: [{ from: ch, to: ch, insert: text }], cursor: ch + text.length };
}

/**
 * Plan for choosing priority `letter` from the "!" sub-list. `span` is the "!query" span to
 * consume. The "(X)" token goes in the leading slot (parse.ts only recognises priority there);
 * the consumed span plus one adjacent space is removed so no double space is left behind.
 */
export function planPriorityEdit(line: string, span: Span, letter: string): EditPlan | null {
	if (!/^[A-Za-z]$/.test(letter)) return null;
	const parsed = parseTaskLineWithSpans(line);
	const bodyStart = checkboxBodyStart(line);
	if (!parsed || bodyStart === null || parsed.task.priority !== null) return null;

	const token = `(${letter.toUpperCase()})`;
	const slot = priorityOffset(line, parsed.spans, bodyStart);

	if (span.start === slot) {
		const next = line[span.end];
		const insert = next === undefined || next === " " ? token : `${token} `;
		const edits = [{ from: span.start, to: span.end, insert }];
		return { edits, cursor: mapCursor(span.end, edits) };
	}

	const removeFrom = line[span.start - 1] === " " && span.start - 1 > slot ? span.start - 1 : span.start;
	const edits: TextEdit[] = [
		{ from: slot, to: slot, insert: `${token} ` },
		{ from: removeFrom, to: span.end, insert: "" },
	];
	return { edits, cursor: mapCursor(span.end, edits) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/suggestFields.test.ts`
Expected: PASS (all tests). If the done-task test fails, check `priorityOffset` returns `completion.end + 1` (17 for `- [x] 2026-09-19 Call !`).

- [ ] **Step 5: Run the whole suite to confirm nothing regressed**

Run: `npm test`
Expected: all test files PASS.

- [ ] **Step 6: Commit**

```bash
git add src/suggestFields.ts tests/suggestFields.test.ts
git commit -m "feat: add pure field-menu suggestions and edit plans" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Obsidian glue (`vocabIndex.ts`, `taskSuggest.ts`, `main.ts`, styles)

Thin adapters; no new unit tests (the pure logic is covered). Verified by type-check, lint, and a live check.

**Files:**
- Create: `src/vocabIndex.ts`
- Rename + rewrite: `src/dateSuggest.ts` → `src/taskSuggest.ts`
- Modify: `src/main.ts`, `styles.css`, `eslint.config.js`

**Interfaces:**
- Consumes: everything produced by Tasks 1-3.
- Produces: `VocabIndex` (`register(plugin)`, `invalidate()`, `get(): Promise<FileVocab>`), `TaskFieldSuggest` (`configure(options)`), two new settings `enableFieldMenu: boolean` (default `true`) and `suggestMaxItems: number` (default `10`, valid 1-50). The existing `enableDateSuggest` key is kept as the master switch so saved settings stay valid.

- [ ] **Step 1: Create `src/vocabIndex.ts`**

```ts
import { App, Plugin, TAbstractFile, TFile, debounce } from "obsidian";
import { extractFileVocab, mergeVocab, isInScanFolders, type FileVocab } from "./vocab";

/**
 * Plugin-owned cache of the vault's +project / @place / #tag names. The aggregated view's own
 * scan is private to the view and only exists while it is open, so the inline popup cannot
 * reuse it. First use scans the vault (honouring `scanFolders`); afterwards vault events update
 * single files, debounced.
 */
export class VocabIndex {
	private readonly perFile = new Map<string, FileVocab>();
	private merged: FileVocab | null = null;
	private building: Promise<void> | null = null;
	private readonly pending = new Set<string>();

	private readonly flush = debounce(
		() => {
			void this.flushPending();
		},
		500,
		true,
	);

	constructor(
		private readonly app: App,
		private readonly getScanFolders: () => string[],
	) {}

	register(plugin: Plugin): void {
		plugin.registerEvent(this.app.vault.on("modify", (file) => this.queue(file)));
		plugin.registerEvent(this.app.vault.on("create", (file) => this.queue(file)));
		plugin.registerEvent(this.app.vault.on("delete", (file) => this.drop(file.path)));
		plugin.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.drop(oldPath);
				this.queue(file);
			}),
		);
	}

	/** Forget everything; the next get() rescans (used when `scanFolders` changes). */
	invalidate(): void {
		this.perFile.clear();
		this.merged = null;
		this.building = null;
	}

	async get(): Promise<FileVocab> {
		if (!this.building) this.building = this.build();
		await this.building;
		if (!this.merged) this.merged = mergeVocab(this.perFile.values());
		return this.merged;
	}

	private async build(): Promise<void> {
		const folders = this.getScanFolders();
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (isInScanFolders(file.path, folders)) await this.index(file);
		}
	}

	private async index(file: TFile): Promise<void> {
		const content = await this.app.vault.cachedRead(file);
		this.perFile.set(file.path, extractFileVocab(content.split("\n")));
		this.merged = null;
	}

	private queue(file: TAbstractFile): void {
		if (!(file instanceof TFile) || file.extension !== "md") return;
		this.pending.add(file.path);
		this.flush();
	}

	private drop(path: string): void {
		this.pending.delete(path);
		if (this.perFile.delete(path)) this.merged = null;
	}

	private async flushPending(): Promise<void> {
		const paths = [...this.pending];
		this.pending.clear();
		const folders = this.getScanFolders();
		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile && isInScanFolders(path, folders)) {
				await this.index(file);
			} else {
				this.drop(path);
			}
		}
	}
}
```

- [ ] **Step 2: Rename the suggest file**

Run: `git mv src/dateSuggest.ts src/taskSuggest.ts`

- [ ] **Step 3: Replace the contents of `src/taskSuggest.ts`**

```ts
import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	TFile,
} from "obsidian";
import { detectTrigger, type TriggerMatch } from "./triggers";
import { suggestDateShortcuts, type DateShortcutSuggestion, type Clock } from "./dates";
import {
	suggestFields,
	planFieldEdit,
	planPriorityEdit,
	planReplace,
	editsDescending,
	type EditPlan,
	type FieldSuggestion,
} from "./suggestFields";
import { rankVocab, type VocabEntry } from "./vocab";
import type { VocabIndex } from "./vocabIndex";

export type TaskSuggestion =
	| { type: "date"; item: DateShortcutSuggestion }
	| { type: "field"; item: FieldSuggestion }
	| { type: "vocab"; prefix: "+" | "@"; item: VocabEntry }
	| { type: "priority"; letter: string };

export interface TaskSuggestOptions {
	enabled: boolean;
	fieldMenu: boolean;
	maxItems: number;
}

const PRIORITY_LETTERS = ["A", "B", "C", "D", "E"];

/**
 * The single inline popup for checkbox lines: date shortcuts after due:/t:/leading ":", a field
 * menu after a space, +project / @place completion, and the "!" priority sub-list
 * (DESIGN_RULES.md section 1.4 "assist, don't nag"; one EditorSuggest only — two registered
 * suggests compete for the same keystroke). All decisions come from the pure triggers.ts /
 * suggestFields.ts / vocab.ts; this class only wires them to Obsidian. "#" is deliberately not
 * handled: Obsidian's native tag popup owns it.
 */
export class TaskFieldSuggest extends EditorSuggest<TaskSuggestion> {
	private options: TaskSuggestOptions = { enabled: true, fieldMenu: true, maxItems: 10 };

	constructor(
		app: App,
		private readonly clock: Clock,
		private readonly vocab: VocabIndex,
	) {
		super(app);
	}

	configure(options: Partial<TaskSuggestOptions>): void {
		this.options = { ...this.options, ...options };
	}

	private currentMatch(editor: Editor): TriggerMatch | null {
		const cursor = editor.getCursor();
		return detectTrigger(editor.getLine(cursor.line), cursor.ch, {
			fieldMenu: this.options.fieldMenu,
		});
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		_file: TFile | null,
	): EditorSuggestTriggerInfo | null {
		if (!this.options.enabled) return null;
		const match = detectTrigger(editor.getLine(cursor.line), cursor.ch, {
			fieldMenu: this.options.fieldMenu,
		});
		if (!match) return null;
		return {
			start: { line: cursor.line, ch: match.start },
			end: { line: cursor.line, ch: match.end },
			query: match.query,
		};
	}

	async getSuggestions(context: EditorSuggestContext): Promise<TaskSuggestion[]> {
		const match = this.currentMatch(context.editor);
		if (!match) return [];
		const max = this.options.maxItems;

		switch (match.kind) {
			case "date":
				return suggestDateShortcuts(match.query, this.clock).map(
					(item): TaskSuggestion => ({ type: "date", item }),
				);
			case "field": {
				const line = context.editor.getLine(context.editor.getCursor().line);
				return suggestFields(line, this.clock)
					.slice(0, max)
					.map((item): TaskSuggestion => ({ type: "field", item }));
			}
			case "priority": {
				const lower = match.query.toLowerCase();
				return PRIORITY_LETTERS.filter((letter) => letter.toLowerCase().startsWith(lower)).map(
					(letter): TaskSuggestion => ({ type: "priority", letter }),
				);
			}
			case "project":
			case "at": {
				const vocab = await this.vocab.get();
				const counts = match.kind === "project" ? vocab.project : vocab.at;
				const prefix = match.kind === "project" ? "+" : "@";
				return rankVocab(counts, match.query, max).map(
					(item): TaskSuggestion => ({ type: "vocab", prefix, item }),
				);
			}
		}
	}

	renderSuggestion(value: TaskSuggestion, el: HTMLElement): void {
		switch (value.type) {
			case "date":
				el.addClass("todotxt-md-date-suggestion");
				el.createSpan({ text: value.item.token, cls: "todotxt-md-date-suggestion-token" });
				if (value.item.iso) {
					el.createSpan({
						text: ` -> ${value.item.iso}`,
						cls: "todotxt-md-date-suggestion-date",
					});
				}
				el.createSpan({
					text: ` (${value.item.label})`,
					cls: "todotxt-md-date-suggestion-label",
				});
				return;
			case "field":
				el.createSpan({ text: value.item.label, cls: "todotxt-md-field-suggestion-label" });
				if (value.item.hint) {
					el.createSpan({
						text: `  ${value.item.hint}`,
						cls: "todotxt-md-suggestion-muted",
					});
				}
				return;
			case "vocab":
				el.createSpan({
					text: `${value.prefix}${value.item.name}`,
					cls: "todotxt-md-field-suggestion-label",
				});
				el.createSpan({
					text: `  ${value.item.count}`,
					cls: "todotxt-md-suggestion-muted",
				});
				return;
			case "priority":
				el.createSpan({
					text: `(${value.letter})`,
					cls: "todotxt-md-field-suggestion-label",
				});
				return;
		}
	}

	selectSuggestion(value: TaskSuggestion, _evt: MouseEvent | KeyboardEvent): void {
		const context = this.context;
		if (!context) return;
		const editor = context.editor;
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const match = this.currentMatch(editor);
		if (!match) return;

		let plan: EditPlan | null = null;
		switch (value.type) {
			case "date":
				if (value.item.iso) plan = planReplace(match, value.item.iso);
				break;
			case "vocab":
				plan = planReplace(match, `${value.prefix}${value.item.name} `);
				break;
			case "priority":
				plan = planPriorityEdit(line, match, value.letter);
				break;
			case "field":
				plan = planFieldEdit(line, cursor.ch, value.item.kind, this.clock);
				break;
		}
		if (!plan) return;

		for (const edit of editsDescending(plan)) {
			editor.replaceRange(
				edit.insert,
				{ line: cursor.line, ch: edit.from },
				{ line: cursor.line, ch: edit.to },
			);
		}
		editor.setCursor({ line: cursor.line, ch: plan.cursor });
	}
}
```

- [ ] **Step 4: Update `src/main.ts` imports, settings type and defaults**

Replace the import line `import { DateShortcutSuggest } from "./dateSuggest";` with:

```ts
import { TaskFieldSuggest } from "./taskSuggest";
import { VocabIndex } from "./vocabIndex";
```

Replace the `TodotxtMdSettings` interface and `DEFAULT_SETTINGS` with:

```ts
interface TodotxtMdSettings {
	defaultPriority: string;
	enableDateSuggest: boolean;
	enableFieldMenu: boolean;
	suggestMaxItems: number;
	scanFolders: string[];
	defaultDueWindow: DueWindow;
	enableAggregatedViewPills: boolean;
	enableInEditorHighlight: boolean;
}

const DEFAULT_SETTINGS: TodotxtMdSettings = {
	defaultPriority: "A",
	enableDateSuggest: true,
	enableFieldMenu: true,
	suggestMaxItems: 10,
	scanFolders: [],
	defaultDueWindow: "all",
	enableAggregatedViewPills: true,
	enableInEditorHighlight: true,
};
```

After `isValidScanFolders`, add:

```ts
function isValidMaxItems(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 50;
}
```

- [ ] **Step 5: Wire the plugin class in `src/main.ts`**

Replace `dateSuggest!: DateShortcutSuggest;` with:

```ts
	taskSuggest!: TaskFieldSuggest;
	vocabIndex!: VocabIndex;
```

Replace the block in `onload` that constructs and registers `DateShortcutSuggest` (the four lines starting `this.dateSuggest = new ...` through `this.registerEditorSuggest(this.dateSuggest);`) with:

```ts
		this.vocabIndex = new VocabIndex(this.app, () => this.settings.scanFolders);
		this.vocabIndex.register(this);
		this.taskSuggest = new TaskFieldSuggest(this.app, systemClock, this.vocabIndex);
		this.taskSuggest.configure({
			enabled: this.settings.enableDateSuggest,
			fieldMenu: this.settings.enableFieldMenu,
			maxItems: this.settings.suggestMaxItems,
		});
		this.registerEditorSuggest(this.taskSuggest);
		this.app.workspace.onLayoutReady(() => {
			void this.vocabIndex.get();
		});
```

In `loadSettings`, after the `enableDateSuggest` entry, add:

```ts
			enableFieldMenu:
				loaded && typeof loaded.enableFieldMenu === "boolean"
					? loaded.enableFieldMenu
					: DEFAULT_SETTINGS.enableFieldMenu,
			suggestMaxItems:
				loaded && isValidMaxItems(loaded.suggestMaxItems)
					? loaded.suggestMaxItems
					: DEFAULT_SETTINGS.suggestMaxItems,
```

- [ ] **Step 6: Update the settings tab in `src/main.ts`**

Replace the whole `new Setting(containerEl).setName("Date shortcut suggestions")...` block with:

```ts
		new Setting(containerEl)
			.setName("Inline suggestions")
			.setDesc(
				'Master switch for the live popups: date shortcuts after "due:"/"t:", the field menu, and +project/@place completion.',
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enableDateSuggest).onChange(async (value) => {
					this.plugin.settings.enableDateSuggest = value;
					this.plugin.taskSuggest.configure({ enabled: value });
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Field menu on space")
			.setDesc(
				"After typing a space on a task line, offer a menu of fields (priority, created date, due:, t:, +, @, #). Press Esc to dismiss it.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enableFieldMenu).onChange(async (value) => {
					this.plugin.settings.enableFieldMenu = value;
					this.plugin.taskSuggest.configure({ fieldMenu: value });
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Max suggestions")
			.setDesc("Most items shown in the field menu and the +project/@place lists (1-50).")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.suggestMaxItems)).onChange(async (value) => {
					const parsed = Number(value);
					if (isValidMaxItems(parsed)) {
						this.plugin.settings.suggestMaxItems = parsed;
						this.plugin.taskSuggest.configure({ maxItems: parsed });
						await this.plugin.saveSettings();
					}
				}),
			);
```

In the "Scan folders" `onChange`, after `this.plugin.settings.scanFolders = folders;` add:

```ts
						this.plugin.vocabIndex.invalidate();
						void this.plugin.vocabIndex.get();
```

- [ ] **Step 7: Add styles**

Append to `styles.css` after the `.todotxt-md-date-suggestion-label` rule:

```css
.todotxt-md-field-suggestion-label {
	font-weight: 600;
}

.todotxt-md-suggestion-muted {
	color: var(--text-muted);
}
```

- [ ] **Step 8: Extend the no-`any` lint rule to the new pure modules**

In `eslint.config.js`, change the `files` array of the pure-core block to:

```js
		files: [
			"src/parse.ts",
			"src/priority.ts",
			"src/dates.ts",
			"src/sort.ts",
			"src/aggregate.ts",
			"src/vocab.ts",
			"src/triggers.ts",
			"src/suggestFields.ts",
		],
```

- [ ] **Step 9: Type-check, lint, test, build**

Run: `npm run build`
Expected: no TypeScript errors; `main.js` produced.

Run: `npm run lint`
Expected: no errors. If prettier reports formatting differences in the new files, run `npx prettier --write src/vocab.ts src/triggers.ts src/suggestFields.ts src/vocabIndex.ts src/taskSuggest.ts src/main.ts` and re-run lint.

Run: `npm test`
Expected: all test files PASS.

- [ ] **Step 10: Live check in Obsidian (desktop)**

Ask the user for the vault path (it is not recorded in-repo), then deploy with `npm run dev:copy` (see `scripts/copy-to-vault.mjs`) and reload the plugin with the Hot Reload plugin. In a note with a few existing tasks using `+Project` and `@place`, check each item and report results to the user:

1. Type `- [ ] Call bank ` — field menu appears; Esc dismisses it; Enter on a fresh `- [ ] ` (empty body) inserts a newline, not a menu row.
2. Choose `Priority`, then `B` — line becomes `- [ ] (B) Call bank`, cursor stays where the `!` was.
3. Choose `due:` — date popup opens by itself; pick `tom` — `due:YYYY-MM-DD` inserted.
4. Choose `Created` — today's ISO date appears right after the checkbox (and after a priority if present).
5. Type `+` — known projects listed, most-used first; type `Fi` to filter; pick one — `+Finance ` inserted, field menu may reopen.
6. Type `@` — same for places; confirm an `@home` is not offered when only `#home` exists.
7. Type `#` — only Obsidian's native tag popup appears.
8. On a done task, `!` then `A` puts `(A)` after the completion date.
9. Type `Call bank!` and `mail a@b.com` — no popup.
10. Turn off "Field menu on space" in settings — menu stops appearing on space; `+`/`@`/`!`/`due:` still work.
11. Interop guard: a `#tag` still shows in the tag pane and a Dataview `TASK` query still lists the tasks.

**Known risk to confirm in 3 and 5:** chaining relies on Obsidian re-evaluating the suggest after the programmatic edit (the Tasks plugin depends on the same behaviour). If a popup does not reopen after selecting a row, stop and report it; do not work around it silently.

- [ ] **Step 11: Android check**

Ask the user to test the same flow on Android (sync or copy the plugin folder) and report: tapping rows works, popup does not cover the keyboard, `!`/`+`/`@` are typeable. Record any problems before merging.

- [ ] **Step 12: Commit**

```bash
git add src/vocabIndex.ts src/taskSuggest.ts src/main.ts styles.css eslint.config.js
git commit -m "feat: add inline field menu, +/@ completion and priority sub-list" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(`git mv` already staged the rename; the `git add` picks up the rewritten content.)

---

### Task 5: Docs and spec amendments

**Files:**
- Modify: `docs/superpowers/specs/2026-10-14-inline-field-helper-design.md`, `SPEC.md`, `README.md`, `CONTRIBUTING.md` only if it lists source files (check; skip if not)

- [ ] **Step 1: Amend the spec**

In `docs/superpowers/specs/2026-10-14-inline-field-helper-design.md`:

1. In the Units table, add a row: `src/triggers.ts | pure, unit-tested | Decide which popup (if any) the cursor position opens, and which span a selection replaces. Holds the trigger-syntax regexes previously in dateSuggest.ts.`, and change the `src/dateSuggest.ts` row to `src/taskSuggest.ts` (renamed; single EditorSuggest).
2. Replace the **Priority** bullet under "Selection and chaining" with: `Priority: selecting it inserts a transient "!" and the same popup shows an A to E sub-list. Choosing a letter removes the "!query" and inserts "(X) " in the leading slot (after a completion date on a done task). The edit is a local insertion computed from parseTaskLineWithSpans; the line is not re-serialised, so tokens mid-typed are never reordered.`
3. Replace "`: Date`" in the field-menu trigger row with "`Created`", and add under chaining: `Created: inserts today's ISO date directly in the leading slot (after any priority); offered only on not-done tasks with no creation date. No sub-list; other dates come from the due:/t:/":" popups.`
4. Under "Interference with the editor", add: `Known limitation: while the field menu is showing (immediately after a typed space), Enter selects the highlighted row. The menu never appears on an empty body, can be dismissed with Esc, and can be switched off in settings.`

- [ ] **Step 2: Record the build in SPEC.md**

Append to SPEC.md after the "Extended 2026-10-04" / "Bug found and fixed same day" paragraphs in the editor-mechanics section:

```markdown
**Extended 2026-10-14** (`src/taskSuggest.ts`, `src/triggers.ts`, `src/suggestFields.ts`,
`src/vocab.ts`, `src/vocabIndex.ts`; see
`docs/superpowers/specs/2026-10-14-inline-field-helper-design.md`): the single `EditorSuggest`
now also offers a field menu after a typed space, `+project` / `@place` completion ranked by
vault-wide frequency, and a `!` priority sub-list; selecting a menu row inserts transient
trigger text so the next popup fires. Trigger detection and edit planning moved into pure,
tested modules. `#` is left to Obsidian's native tag popup.
```

- [ ] **Step 3: Update the README**

In `README.md`, where the date-shortcut popup is described, add a short paragraph: after typing a space on a task line a field menu offers priority, created date, `due:`, `t:`, `+project`, `@place` and `#tag`; typing `+` or `@` lists names already used in your tasks, most used first; and the menu can be turned off in settings. Match the surrounding style and length; read the nearby section before editing.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-14-inline-field-helper-design.md SPEC.md README.md
git commit -m "docs: record inline field helper in spec, SPEC.md and README" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Final verification before merge**

Run: `npm run build && npm run lint && npm test`
Expected: all pass. Then use superpowers:finishing-a-development-branch to decide how to integrate `feat/inline-field-helper`.
