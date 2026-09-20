# Date-Suggest Popup + Aggregated Task View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Testing note (project-specific deviation from the default TDD template):** this repo's own
> convention (`DESIGN_RULES.md` §3.1, §5.1-5.2) splits work into pure-core modules (unit-tested,
> TDD-style, no Obsidian import) and Obsidian-glue modules (manually verified live in a test
> vault, zero unit tests — this is how `src/editor.ts` is already built and verified). Tasks
> below follow strict write-test-first TDD for pure-core files (`dates.ts`, `sort.ts`,
> `aggregate.ts`). Tasks for glue files (`dateSuggest.ts`, `view.ts`, `main.ts` wiring) replace
> the "write failing test" / "run test" steps with "manually verify in the test vault" steps,
> per that established pattern — do not invent unit tests for Obsidian-API-dependent code.

**Goal:** Add a live date-shortcut suggestion popup (`due:`/`t:` autocomplete) and an aggregated
cross-file task view with filter/sort, per the two decisions recorded in `DECISIONS.md`
(2026-09-20 entries) and the v1 scope in `PLAN.md`.

**Architecture:** Two independent, additive features sharing the existing pure-core/thin-glue
split. Date-suggest extends `src/dates.ts` (pure) + a new `src/dateSuggest.ts`
(`EditorSuggest` glue). Aggregated view extends `src/sort.ts` (pure, small refactor) + a new
`src/aggregate.ts` (pure filter/sort) + a new `src/view.ts` (`ItemView` glue). Both wire into
`src/main.ts`. No existing exported function's signature or behavior changes except where
explicitly noted (the `sort.ts` refactor is behavior-preserving).

**Tech Stack:** TypeScript (strict), Obsidian Plugin API (`EditorSuggest`, `ItemView`,
`registerEditorSuggest`, `registerView`, `debounce`), Vitest for pure-core unit tests, esbuild
bundler (existing `npm run build`/`npm run dev`).

**Spec:** `PLAN.md` (v1 scope, "Editor mechanics", Verification section 5) and `DECISIONS.md`
(2026-09-20 entries: dropping Dataview due-date interop, pulling the aggregated view into v1).
Executors should read both before starting.

## Global Constraints

- **No emojis anywhere** — not in stored task text, not in UI chrome/labels/icons rendered by
  the new popup or view (`DESIGN_RULES.md` §1.2). Use plain ASCII (e.g. `->` not an arrow glyph)
  and built-in Obsidian icon identifiers (e.g. `"checkmark"`), never literal emoji characters.
- **TypeScript strict mode, no `any`** in `src/dates.ts`, `src/sort.ts`, `src/aggregate.ts` (the
  pure core) — this is lint-enforced (`eslint.config.js` scopes `no-explicit-any: error` to
  these files already; add `src/aggregate.ts` to that scope list as part of this work).
  `src/dateSuggest.ts` and `src/view.ts` are Obsidian glue and outside that lint rule, but avoid
  `any` there too unless the Obsidian API genuinely requires a cast (document why inline).
- **Never call `new Date()` directly in logic that should be deterministic/testable** — always
  take an injected `Clock = () => Date` (existing type from `src/dates.ts`), exactly as
  `expandDateToken` already does (`DESIGN_RULES.md` §3.2).
- **"Assist, don't nag"** (`DESIGN_RULES.md` §1.4) — the date-suggest popup must never trigger
  outside a bounded `due:`/`t:` context on a checkbox line; it must never fire on generic prose.
- **Register everything through the Plugin/Component lifecycle** (`registerEditorSuggest`,
  `registerView`, `registerEvent`) — no manual `vault.on`/`.off()` pairs, no leaked listeners
  (`DESIGN_RULES.md` §4.2).
- **Pure core litmus test**: "could this run in plain Node with no Obsidian mock?" — if yes, it
  belongs in `dates.ts`/`sort.ts`/`aggregate.ts`, not in `dateSuggest.ts`/`view.ts`.
- **Existing exported behavior must not regress**: `expandDateToken`'s signature/behavior is
  unchanged; `sortLines`/`defaultComparator`'s exported behavior is unchanged (the refactor is
  an internal extraction only — `tests/sort.test.ts` must pass unmodified).

---

## Part A: Live Date-Shortcut Suggestion Popup

### Task 1: Add `suggestDateShortcuts` to `src/dates.ts`

**Files:**
- Modify: `src/dates.ts`
- Test: `tests/dates.test.ts`

**Interfaces:**
- Consumes: nothing new — reuses `Clock`, `WEEKDAYS`, `RELATIVE_RE`, `toIso`, `addDays`, and
  `expandDateToken` already defined in `src/dates.ts`.
- Produces: `DateShortcutSuggestion` interface and `suggestDateShortcuts(partial: string, clock:
  Clock): DateShortcutSuggestion[]`, both exported from `src/dates.ts`. Task 3 (`dateSuggest.ts`)
  imports both directly.

- [x] **Step 1: Write the failing tests**

Add to `tests/dates.test.ts` (new `describe` block, reusing the existing `fixedClock` at the top
of the file — Saturday 2026-09-19):

```ts
import { expandDateToken, suggestDateShortcuts, type Clock } from "../src/dates";

describe("suggestDateShortcuts", () => {
	it("returns all 9 shortcuts for an empty partial, in a fixed order", () => {
		const results = suggestDateShortcuts("", fixedClock);
		expect(results.map((r) => r.token)).toEqual([
			"tod", "tom", "sun", "mon", "tue", "wed", "thu", "fri", "sat",
		]);
	});

	it("each empty-partial suggestion resolves to the same ISO date expandDateToken gives", () => {
		const results = suggestDateShortcuts("", fixedClock);
		for (const r of results) {
			if (r.iso !== null) {
				expect(r.iso).toBe(expandDateToken(r.token, fixedClock));
			}
		}
	});

	it('narrows to "tod" and "tom" for partial "t"', () => {
		const results = suggestDateShortcuts("t", fixedClock);
		expect(results.map((r) => r.token).sort()).toEqual(["tod", "tom"]);
	});

	it('narrows to exactly "tod" for partial "tod"', () => {
		const results = suggestDateShortcuts("tod", fixedClock);
		expect(results.map((r) => r.token)).toEqual(["tod"]);
		expect(results[0].iso).toBe("2026-09-19");
	});

	it('narrows to "mon" only for partial "m"', () => {
		const results = suggestDateShortcuts("m", fixedClock);
		expect(results.map((r) => r.token)).toEqual(["mon"]);
		expect(results[0].iso).toBe("2026-09-21");
	});

	it('returns an unresolved hint entry for partial "+"', () => {
		const results = suggestDateShortcuts("+", fixedClock);
		expect(results).toHaveLength(1);
		expect(results[0].iso).toBeNull();
	});

	it('returns an unresolved hint entry for an incomplete partial "+3"', () => {
		const results = suggestDateShortcuts("+3", fixedClock);
		expect(results).toHaveLength(1);
		expect(results[0].iso).toBeNull();
	});

	it('resolves a complete relative-offset partial "+3d"', () => {
		const results = suggestDateShortcuts("+3d", fixedClock);
		expect(results).toHaveLength(1);
		expect(results[0].iso).toBe("2026-09-22");
	});

	it("returns an empty array for an unmatched partial", () => {
		expect(suggestDateShortcuts("xyz", fixedClock)).toEqual([]);
		expect(suggestDateShortcuts("banana", fixedClock)).toEqual([]);
	});

	it("is case-insensitive", () => {
		const results = suggestDateShortcuts("TOD", fixedClock);
		expect(results.map((r) => r.token)).toEqual(["tod"]);
	});
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `suggestDateShortcuts` is not exported from `src/dates.ts` (TypeScript/Vitest
import error).

- [x] **Step 3: Implement `suggestDateShortcuts` in `src/dates.ts`**

Add below the existing `expandDateToken` function (do not modify `expandDateToken` itself):

```ts
export interface DateShortcutSuggestion {
	/** The shortcut token as the user would type it, e.g. "tod", "mon", "+3d". */
	token: string;
	/** Resolved ISO date, e.g. "2026-09-20". Null only for the relative-offset pattern hint. */
	iso: string | null;
	/** Short human label shown alongside the date, e.g. "today", "next Monday". */
	label: string;
}

const WEEKDAY_LABELS: Record<string, string> = {
	sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday",
	thu: "Thursday", fri: "Friday", sat: "Saturday",
};

/**
 * Enumerates date-shortcut suggestions whose token starts with `partial` (case-insensitive).
 * Used by the live-suggestion popup (dateSuggest.ts) to show multiple candidates as the user
 * types; distinct from expandDateToken, which resolves one *complete* token. Pure/deterministic
 * via the same injected clock. Returns [] for an unmatched partial — the caller decides whether
 * to show a popup at all (this function does not gate on "should a popup appear").
 */
export function suggestDateShortcuts(partial: string, clock: Clock): DateShortcutSuggestion[] {
	const lower = partial.toLowerCase();

	if (lower.startsWith("+")) {
		if (RELATIVE_RE.test(lower)) {
			const iso = expandDateToken(lower, clock);
			return iso ? [{ token: lower, iso, label: "relative offset" }] : [];
		}
		// Incomplete relative pattern ("+", "+3") — show a non-resolving hint row.
		if (/^\+\d*$/.test(lower)) {
			return [{ token: "+Nd", iso: null, label: "relative offset, e.g. +3d or +1w" }];
		}
		return [];
	}

	const candidates: Array<{ token: string; label: string }> = [
		{ token: "tod", label: "today" },
		{ token: "tom", label: "tomorrow" },
		...WEEKDAYS.map((day) => ({ token: day, label: WEEKDAY_LABELS[day] })),
	];

	return candidates
		.filter((c) => c.token.startsWith(lower))
		.map((c) => ({ token: c.token, iso: expandDateToken(c.token, clock), label: c.label }));
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `suggestDateShortcuts` tests green, all pre-existing `dates.test.ts` tests
still green (unmodified).

- [x] **Step 5: Lint and typecheck**

Run: `npm run lint && npx tsc -noEmit -skipLibCheck`
Expected: no errors (no `any` introduced; `suggestDateShortcuts` is fully typed).

- [x] **Step 6: Commit**

```bash
git add src/dates.ts tests/dates.test.ts
git commit -m "feat: add suggestDateShortcuts for date-suggest popup enumeration"
```

---

### Task 2: Create `src/dateSuggest.ts` (EditorSuggest glue)

**Files:**
- Create: `src/dateSuggest.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `suggestDateShortcuts`, `DateShortcutSuggestion`, `Clock` from `./dates`
  (Task 1); `parseTaskLine` from `./parse` (existing, unchanged).
- Produces: `DateShortcutSuggest` class (extends Obsidian's `EditorSuggest<DateShortcutSuggestion>`)
  with a public `setEnabled(enabled: boolean): void` method. Task 4 (`main.ts`) instantiates and
  registers this class, and calls `setEnabled` from the settings tab.

- [x] **Step 1: Write `src/dateSuggest.ts`**

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
import { parseTaskLine } from "./parse";
import { suggestDateShortcuts, type DateShortcutSuggestion, type Clock } from "./dates";

const TRIGGER_RE = /(?:due|t):([A-Za-z0-9+]*)$/;

/**
 * Live date-shortcut popup. Triggers only immediately after "due:" or "t:" on a checkbox
 * line (DESIGN_RULES.md section 1.4 "assist, don't nag") — never on generic prose, even
 * prose starting with a date-shortcut-looking word. Additive to the explicit "Expand date
 * token" command in editor.ts; both call into the same dates.ts core.
 */
export class DateShortcutSuggest extends EditorSuggest<DateShortcutSuggestion> {
	private enabled = true;

	constructor(
		app: App,
		private readonly clock: Clock,
	) {
		super(app);
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
		if (!this.enabled) return null;

		const line = editor.getLine(cursor.line);
		if (!parseTaskLine(line)) return null;

		const beforeCursor = line.slice(0, cursor.ch);
		const match = TRIGGER_RE.exec(beforeCursor);
		if (!match) return null;

		const query = match[1];
		return {
			start: { line: cursor.line, ch: cursor.ch - query.length },
			end: cursor,
			query,
		};
	}

	getSuggestions(context: EditorSuggestContext): DateShortcutSuggestion[] {
		return suggestDateShortcuts(context.query, this.clock);
	}

	renderSuggestion(value: DateShortcutSuggestion, el: HTMLElement): void {
		el.addClass("todotxt-md-date-suggestion");
		el.createSpan({ text: value.token, cls: "todotxt-md-date-suggestion-token" });
		if (value.iso) {
			el.createSpan({ text: ` -> ${value.iso}`, cls: "todotxt-md-date-suggestion-date" });
		}
		el.createSpan({ text: ` (${value.label})`, cls: "todotxt-md-date-suggestion-label" });
	}

	selectSuggestion(value: DateShortcutSuggestion, _evt: MouseEvent | KeyboardEvent): void {
		if (!value.iso || !this.context) return;
		const { start, end, editor } = this.context;

		editor.replaceRange(value.iso, start, end);
		editor.setCursor({ line: start.line, ch: start.ch + value.iso.length });
	}
}
```

- [x] **Step 2: Add popup styling to `styles.css`**

Append to the existing `styles.css` (currently just a one-line comment — keep it minimal, text
color via Obsidian's own CSS variables so it matches both light/dark themes):

```css

.todotxt-md-date-suggestion-token {
	font-weight: 600;
}

.todotxt-md-date-suggestion-date {
	color: var(--text-accent);
}

.todotxt-md-date-suggestion-label {
	color: var(--text-muted);
}
```

- [x] **Step 3: Typecheck**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: no errors. This file has no unit tests (Obsidian-glue, per the testing-note at the top
of this plan) — verification happens live in Task 4's manual-check step.

- [x] **Step 4: Commit**

```bash
git add src/dateSuggest.ts styles.css
git commit -m "feat: add DateShortcutSuggest EditorSuggest popup"
```

---

### Task 3: Wire the date-suggest popup into `src/main.ts`

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `DateShortcutSuggest` from `./dateSuggest` (Task 2); existing `systemClock`,
  `TodotxtMdSettings`, `DEFAULT_SETTINGS`, `TodotxtMdSettingTab` already in `src/main.ts`.
- Produces: extended `TodotxtMdSettings` with `enableDateSuggest: boolean`; a `dateSuggest`
  field on `TodotxtMdPlugin`.

- [x] **Step 1: Extend settings shape**

In `src/main.ts`, modify the `TodotxtMdSettings` interface and `DEFAULT_SETTINGS`:

```ts
interface TodotxtMdSettings {
	defaultPriority: string;
	enableDateSuggest: boolean;
}

const DEFAULT_SETTINGS: TodotxtMdSettings = {
	defaultPriority: "A",
	enableDateSuggest: true,
};
```

Update `loadSettings()` to validate the new field, following the exact pattern already used for
`defaultPriority`:

```ts
async loadSettings(): Promise<void> {
	const loaded = (await this.loadData()) as Partial<TodotxtMdSettings> | null;
	this.settings = {
		defaultPriority:
			loaded && isValidPriority(loaded.defaultPriority)
				? loaded.defaultPriority
				: DEFAULT_SETTINGS.defaultPriority,
		enableDateSuggest:
			loaded && typeof loaded.enableDateSuggest === "boolean"
				? loaded.enableDateSuggest
				: DEFAULT_SETTINGS.enableDateSuggest,
	};
}
```

- [x] **Step 2: Instantiate and register the suggest in `onload`**

Add the import at the top of `src/main.ts`:

```ts
import { DateShortcutSuggest } from "./dateSuggest";
```

Add a class field on `TodotxtMdPlugin`:

```ts
dateSuggest!: DateShortcutSuggest;
```

In `onload()`, after `await this.loadSettings();` and before the existing `addCommand` calls,
add:

```ts
this.dateSuggest = new DateShortcutSuggest(this.app, systemClock);
this.dateSuggest.setEnabled(this.settings.enableDateSuggest);
this.registerEditorSuggest(this.dateSuggest);
```

- [x] **Step 3: Add the settings-tab toggle**

In `TodotxtMdSettingTab.display()`, after the existing "Default priority" `Setting`, add:

```ts
new Setting(containerEl)
	.setName("Date shortcut suggestions")
	.setDesc('Show a live popup with date-shortcut suggestions after typing "due:" or "t:".')
	.addToggle((toggle) =>
		toggle.setValue(this.plugin.settings.enableDateSuggest).onChange(async (value) => {
			this.plugin.settings.enableDateSuggest = value;
			this.plugin.dateSuggest.setEnabled(value);
			await this.plugin.saveSettings();
		}),
	);
```

- [x] **Step 4: Build and typecheck**

Run: `npm run build`
Expected: builds cleanly, `main.js` regenerated with no TypeScript errors.

- [x] **Step 5: Manually verify in the test vault**

Rebuild (`npm run build` or leave `npm run dev` running) so the symlinked test vault at
`C:\Users\apdev\Documents\github\obsidian\test` picks up the change, then in Obsidian:

1. Reload the plugin (disable/re-enable "Todo.txt MD" in Community Plugins, or restart Obsidian)
   so the new command/setting registration takes effect.
2. On a checkbox line, type `- [ ] Call bank due:` then `tod` — a popup should appear right
   after `due:` starts and narrow as `t`/`to`/`tod` is typed.
3. Press Enter on the `tod` suggestion — it should replace `tod` with the ISO date
   (`2026-09-20` or whatever today's date is) and leave the cursor immediately after it.
4. Type `t:mon` on a checkbox line — same popup behavior for the threshold field.
5. Type the word "today" in a task's description (not after `due:`/`t:`) — the popup must NOT
   appear.
6. Type "today" in a plain paragraph (non-checkbox line) elsewhere in the note — the popup must
   NOT appear.
7. Type `due:+` then `3` then `d` — a hint row should show while incomplete (`+Nd`, unselectable
   /no-op if clicked), resolving to a real `+3d` suggestion once complete.
8. In Settings -> Todo.txt MD, toggle "Date shortcut suggestions" off — confirm the popup
   immediately stops appearing without needing to reload the plugin. Toggle back on — confirm it
   immediately resumes.
9. Confirm the existing "Expand date token" command (hotkey/command-palette) still works
   unmodified — this is a regression check on `expandDateTokenAtCursor` in `editor.ts`, which
   this task does not touch.

**Bug found during manual verification, fixed before commit:** Task 2's original
`TRIGGER_RE = /(?:due|t):([A-Za-z0-9+]*)$/` matched "due:"/"t:" as a bare substring anywhere in
the line, so typing a `#due` or `#t` context tag followed by a colon (e.g. `#due:tod`)
incorrectly fired the popup — the regex had no word-boundary requirement. Fixed in
`src/dateSuggest.ts` by changing the pattern to
`/(?:^|\s)(?:due|t):([A-Za-z0-9+]*)$/` (require start-of-line or preceding whitespace before
`due:`/`t:`), matching how `parse.ts`'s word-split tokenizer would actually recognize the field.
The `start` position calculation (`cursor.ch - query.length`) was already independent of the
match's leading boundary character, so no other code needed to change.

- [x] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire DateShortcutSuggest into plugin with a settings toggle"
```

---

## Part B: Aggregated Cross-File Task View

### Task 4: Extract `compareTasks` in `src/sort.ts` (behavior-preserving refactor)

**Files:**
- Modify: `src/sort.ts`
- Test: `tests/sort.test.ts` (must pass unmodified; one new test added)

**Interfaces:**
- Consumes: `Task`, `parseTaskLine` from `./parse` (existing).
- Produces: new exported `compareTasks(a: Task, b: Task): number`. `sortLines` and
  `defaultComparator`'s exported behavior is unchanged. Task 5 (`aggregate.ts`) imports
  `compareTasks` directly.

- [x] **Step 1: Write the failing test for the new export**

Add to `tests/sort.test.ts` (new `describe` block; needs `parseTaskLine` imported):

```ts
import { parseTaskLine } from "../src/parse";
import { compareTasks } from "../src/sort";

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
```

- [x] **Step 2: Run tests to verify the new test fails**

Run: `npm test`
Expected: FAIL — `compareTasks` is not exported from `src/sort.ts`.

- [x] **Step 3: Refactor `src/sort.ts` to extract `compareTasks`**

Replace the full contents of `src/sort.ts` with:

```ts
import { parseTaskLine, type Task } from "./parse";

/**
 * Default comparator operating on parsed Tasks directly: priority ascending (none last),
 * then due date ascending (none last), then creation date ascending (none last). Shared by
 * this file's line-based compareLines and aggregate.ts's Task-based sorting so both stay
 * in sync (DESIGN_RULES.md section 3.2: sorting must be stable and total).
 */
export function compareTasks(a: Task, b: Task): number {
	const prioA = a.priority ?? "￿";
	const prioB = b.priority ?? "￿";
	if (prioA !== prioB) return prioA < prioB ? -1 : 1;

	const dueA = a.due ?? "￿";
	const dueB = b.due ?? "￿";
	if (dueA !== dueB) return dueA < dueB ? -1 : 1;

	const creationA = a.creationDate ?? "￿";
	const creationB = b.creationDate ?? "￿";
	if (creationA !== creationB) return creationA < creationB ? -1 : 1;

	return 0;
}

function compareLines(a: string, b: string): number {
	const taskA = parseTaskLine(a);
	const taskB = parseTaskLine(b);

	if (!taskA && !taskB) return 0;
	if (!taskA) return 1;
	if (!taskB) return -1;

	return compareTasks(taskA, taskB);
}

/**
 * Sorts a contiguous block of lines in place (returns a new array — caller writes it back).
 * A comparator may be supplied to override the default ordering; sort is stable regardless.
 */
export function sortLines(
	lines: string[],
	comparator: (a: string, b: string) => number = compareLines,
): string[] {
	return [...lines].sort(comparator);
}

export { compareLines as defaultComparator };
```

This is a pure extraction — `compareLines`'s external behavior (and therefore `sortLines`'s and
`defaultComparator`'s) is byte-for-byte identical to before; only the internal comparison logic
moved into the new exported `compareTasks`.

- [x] **Step 4: Run all tests to verify everything passes**

Run: `npm test`
Expected: PASS — the new `compareTasks` tests pass, and all pre-existing `sort.test.ts` tests
(6 tests: priority ordering, due-date tiebreak, creation-date tiebreak, stability, no-mutation,
non-task-lines-last) pass unmodified.

- [x] **Step 5: Lint and typecheck**

Run: `npm run lint && npx tsc -noEmit -skipLibCheck`
Expected: no errors.

- [x] **Step 6: Commit**

```bash
git add src/sort.ts tests/sort.test.ts
git commit -m "refactor: extract compareTasks from sort.ts for reuse in aggregate.ts"
```

---

### Task 5: Create `src/aggregate.ts` (pure filter/sort core)

**Files:**
- Create: `src/aggregate.ts`
- Test: `tests/aggregate.test.ts`

**Interfaces:**
- Consumes: `Task` from `./parse`; `compareTasks` from `./sort` (Task 4); `Clock` from
  `./dates` (existing).
- Produces: `TaskRecord`, `DueWindow`, `AggregateFilter`, `DEFAULT_FILTER`, `matchesDueWindow`,
  `aggregateTasks` — all exported from `src/aggregate.ts`. Task 6 (`view.ts`) imports all of
  these directly.

- [x] **Step 1: Write the failing tests**

Create `tests/aggregate.test.ts`:

```ts
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
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `src/aggregate.ts` does not exist yet (module not found).

- [x] **Step 3: Implement `src/aggregate.ts`**

```ts
import type { Task } from "./parse";
import { compareTasks } from "./sort";
import type { Clock } from "./dates";

/**
 * A parsed task plus its source location, produced by view.ts's vault scan. Pure data — no
 * Obsidian types — so this module's filter/sort logic is fully unit-testable
 * (DESIGN_RULES.md section 3.1 litmus test: "could this run in plain Node with no Obsidian
 * mock?").
 */
export interface TaskRecord {
	task: Task;
	filePath: string;
	/** 0-indexed line number, matching Editor.setCursor's line convention. */
	line: number;
}

export type DueWindow = "all" | "overdue" | "today" | "this-week" | "none";

export interface AggregateFilter {
	/** AND semantics: task must have ALL listed contexts. */
	contexts: string[];
	/** AND semantics: task must have ALL listed projects. */
	projects: string[];
	dueWindow: DueWindow;
	includeDone: boolean;
}

export const DEFAULT_FILTER: AggregateFilter = {
	contexts: [],
	projects: [],
	dueWindow: "all",
	includeDone: false,
};

function toIso(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
	const result = new Date(date.getTime());
	result.setDate(result.getDate() + days);
	return result;
}

/**
 * Returns whether `due` (ISO date or null) falls within `window`, evaluated relative to
 * `clock()` — never `new Date()` directly (DESIGN_RULES.md section 3.2). "This week" is a
 * rolling 7-day window (today through today+6 inclusive), not calendar-week-aligned, since
 * no first-day-of-week setting exists elsewhere in the grammar/settings.
 */
export function matchesDueWindow(due: string | null, window: DueWindow, clock: Clock): boolean {
	if (window === "all") return true;
	if (window === "none") return due === null;
	if (due === null) return false;

	const today = toIso(clock());
	if (window === "overdue") return due < today;
	if (window === "today") return due === today;

	const weekEnd = toIso(addDays(clock(), 6));
	return due >= today && due <= weekEnd;
}

/**
 * Filters and sorts a list of TaskRecords per `filter`. Sort uses compareTasks (priority, due,
 * creation date ascending) applied directly to Task objects — no line-serialize round-trip.
 */
export function aggregateTasks(
	records: TaskRecord[],
	filter: AggregateFilter,
	clock: Clock,
): TaskRecord[] {
	const filtered = records.filter(({ task }) => {
		if (!filter.includeDone && task.done) return false;
		if (filter.contexts.some((c) => !task.contexts.includes(c))) return false;
		if (filter.projects.some((p) => !task.projects.includes(p))) return false;
		if (!matchesDueWindow(task.due, filter.dueWindow, clock)) return false;
		return true;
	});

	return [...filtered].sort((a, b) => compareTasks(a.task, b.task));
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `aggregate.test.ts` tests green, all other test files unaffected.

- [x] **Step 5: Add `src/aggregate.ts` to the ESLint no-explicit-any scope**

In `eslint.config.js`, find the block scoping `no-explicit-any` to the pure-core files and add
`src/aggregate.ts` to its `files` array (alongside `src/parse.ts`, `src/priority.ts`,
`src/dates.ts`, `src/sort.ts`).

- [x] **Step 6: Lint and typecheck**

Run: `npm run lint && npx tsc -noEmit -skipLibCheck`
Expected: no errors.

- [x] **Step 7: Commit**

```bash
git add src/aggregate.ts tests/aggregate.test.ts eslint.config.js
git commit -m "feat: add aggregate.ts with due-window filtering and sorting"
```

---

### Task 6: Create `src/view.ts` (ItemView glue)

**Files:**
- Create: `src/view.ts`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `TaskRecord`, `AggregateFilter`, `DEFAULT_FILTER`, `DueWindow`, `aggregateTasks`
  from `./aggregate` (Task 5); `parseTaskLine` from `./parse`; `Clock` from `./dates`; the
  `TodotxtMdPlugin` type from `./main` (for the `scanFolders`/`defaultDueWindow` settings added
  in Task 7 — this creates a one-directional type-only dependency from `view.ts` to `main.ts`,
  which is fine since `main.ts` imports `view.ts` at runtime, not vice versa).
- Produces: `TASK_VIEW_TYPE` constant and `AggregatedTaskView` class (extends `ItemView`). Task
  7 (`main.ts`) imports both.

- [x] **Step 1: Write `src/view.ts`**

```ts
import { ItemView, WorkspaceLeaf, TFile, debounce, type Editor } from "obsidian";
import type TodotxtMdPlugin from "./main";
import { parseTaskLine } from "./parse";
import {
	aggregateTasks,
	DEFAULT_FILTER,
	type AggregateFilter,
	type TaskRecord,
} from "./aggregate";
import type { Clock } from "./dates";

export const TASK_VIEW_TYPE = "todotxt-md-aggregated-view";

const systemClock: Clock = () => new Date();

export class AggregatedTaskView extends ItemView {
	private plugin: TodotxtMdPlugin;
	private filter: AggregateFilter = { ...DEFAULT_FILTER };
	private records: TaskRecord[] = [];
	private clock: Clock;

	private readonly handleVaultChange = debounce(
		() => {
			void this.rescan();
		},
		500,
		true,
	);

	constructor(leaf: WorkspaceLeaf, plugin: TodotxtMdPlugin, clock: Clock = systemClock) {
		super(leaf);
		this.plugin = plugin;
		this.clock = clock;
	}

	getViewType(): string {
		return TASK_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Tasks";
	}

	getIcon(): string {
		return "checkmark";
	}

	async onOpen(): Promise<void> {
		this.registerEvent(this.app.vault.on("modify", this.handleVaultChange));
		this.registerEvent(this.app.vault.on("create", this.handleVaultChange));
		this.registerEvent(this.app.vault.on("delete", this.handleVaultChange));
		this.registerEvent(this.app.vault.on("rename", this.handleVaultChange));

		this.filter = { ...DEFAULT_FILTER, dueWindow: this.plugin.settings.defaultDueWindow };
		await this.rescan();
	}

	private async rescan(): Promise<void> {
		this.records = await this.scanVault();
		this.render();
	}

	private async scanVault(): Promise<TaskRecord[]> {
		const files = this.app.vault.getMarkdownFiles();
		const scanFolders = this.plugin.settings.scanFolders;
		const scopedFiles = scanFolders.length
			? files.filter((f) =>
					scanFolders.some((folder) => f.path === folder || f.path.startsWith(folder + "/")),
				)
			: files;

		const records: TaskRecord[] = [];
		for (const file of scopedFiles) {
			const content = await this.app.vault.cachedRead(file);
			const lines = content.split("\n");
			lines.forEach((lineText, index) => {
				const task = parseTaskLine(lineText);
				if (task) records.push({ task, filePath: file.path, line: index });
			});
		}
		return records;
	}

	private render(): void {
		const container = this.contentEl;
		container.empty();

		this.renderFilterControls(container);

		const listEl = container.createDiv({ cls: "todotxt-md-task-list" });
		const visible = aggregateTasks(this.records, this.filter, this.clock);

		if (visible.length === 0) {
			listEl.createDiv({ text: "No matching tasks.", cls: "todotxt-md-empty" });
			return;
		}

		for (const record of visible) {
			const item = listEl.createDiv({ cls: "todotxt-md-task-item" });
			item.setText(this.formatTaskLabel(record));
			item.addEventListener("click", () => {
				void this.jumpToTask(record);
			});
		}
	}

	private formatTaskLabel(record: TaskRecord): string {
		const { task } = record;
		const parts: string[] = [];
		if (task.priority) parts.push(`(${task.priority})`);
		parts.push(task.description || "(no description)");
		if (task.due) parts.push(`due:${task.due}`);
		parts.push(`- ${record.filePath}`);
		return parts.join(" ");
	}

	private renderFilterControls(container: HTMLElement): void {
		const controls = container.createDiv({ cls: "todotxt-md-filter-controls" });

		const dueWindowSelect = controls.createEl("select", { cls: "todotxt-md-due-filter" });
		const options: Array<[string, string]> = [
			["all", "All"],
			["overdue", "Overdue"],
			["today", "Today"],
			["this-week", "This week"],
			["none", "No due date"],
		];
		for (const [value, label] of options) {
			const opt = dueWindowSelect.createEl("option", { value, text: label });
			if (value === this.filter.dueWindow) opt.selected = true;
		}
		dueWindowSelect.addEventListener("change", () => {
			this.filter = { ...this.filter, dueWindow: dueWindowSelect.value as AggregateFilter["dueWindow"] };
			this.render();
		});

		const includeDoneLabel = controls.createEl("label", { cls: "todotxt-md-include-done" });
		const includeDoneCheckbox = includeDoneLabel.createEl("input", { type: "checkbox" });
		includeDoneCheckbox.checked = this.filter.includeDone;
		includeDoneLabel.appendText(" Include done");
		includeDoneCheckbox.addEventListener("change", () => {
			this.filter = { ...this.filter, includeDone: includeDoneCheckbox.checked };
			this.render();
		});
	}

	private async jumpToTask(record: TaskRecord): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(record.filePath);
		if (!(file instanceof TFile)) return;

		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);

		const view = leaf.view as { editor?: Editor };
		if (view.editor) {
			view.editor.setCursor({ line: record.line, ch: 0 });
		}
	}
}
```

Note: context/project filtering controls are deliberately omitted from this first pass of
`renderFilterControls` — `aggregateTasks` and `AggregateFilter` already support them (Task 5),
so this is a pure UI addition, not an architecture change. Keep the first working version to
due-window + include-done (the two hardest-to-verify-by-eye filters) and add context/project
`<select>` controls as a follow-up once the due-window/click-to-jump path is confirmed working
live — do not block this task on building every control at once.

- [x] **Step 2: Add minimal view styling to `styles.css`**

Append:

```css

.todotxt-md-filter-controls {
	display: flex;
	gap: 0.5em;
	align-items: center;
	margin-bottom: 0.5em;
}

.todotxt-md-task-item {
	padding: 0.25em 0;
	cursor: pointer;
}

.todotxt-md-task-item:hover {
	background-color: var(--background-modifier-hover);
}

.todotxt-md-empty {
	color: var(--text-muted);
}
```

- [x] **Step 3: Typecheck**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: this will FAIL at this step, because `src/main.ts` does not yet export a default
`TodotxtMdPlugin` type usable here, and `this.plugin.settings.scanFolders`/`defaultDueWindow`
don't exist until Task 7 extends `TodotxtMdSettings`. This is expected and resolved by Task 7 —
do not attempt to make Task 6 typecheck in isolation; proceed directly to Task 7, then typecheck
both together.

- [x] **Step 4: Commit**

```bash
git add src/view.ts styles.css
git commit -m "feat: add AggregatedTaskView (WIP, wired in next task)"
```

---

### Task 7: Wire the aggregated view into `src/main.ts`

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `TASK_VIEW_TYPE`, `AggregatedTaskView` from `./view` (Task 6); `DueWindow` type
  from `./aggregate` (Task 5).
- Produces: extended `TodotxtMdSettings` with `scanFolders: string[]` and `defaultDueWindow:
  DueWindow`; a registered view type; an "Open aggregated task view" command; an
  `activateTaskView()` method on `TodotxtMdPlugin`.

- [ ] **Step 1: Extend settings shape further**

Continuing from Task 3's settings shape, extend again:

```ts
import type { DueWindow } from "./aggregate";

interface TodotxtMdSettings {
	defaultPriority: string;
	enableDateSuggest: boolean;
	scanFolders: string[];
	defaultDueWindow: DueWindow;
}

const DEFAULT_SETTINGS: TodotxtMdSettings = {
	defaultPriority: "A",
	enableDateSuggest: true,
	scanFolders: [],
	defaultDueWindow: "all",
};
```

`scanFolders: []` means "scan the whole vault" (no path filtering) — the zero-config default,
matching `PLAN.md`'s "one file per project area... ad-hoc tasks in daily notes" location model
without requiring upfront folder configuration before the view is useful.

Update `loadSettings()` to validate both new fields:

```ts
const VALID_DUE_WINDOWS: DueWindow[] = ["all", "overdue", "today", "this-week", "none"];

function isValidDueWindow(value: unknown): value is DueWindow {
	return typeof value === "string" && (VALID_DUE_WINDOWS as string[]).includes(value);
}

function isValidScanFolders(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}
```

```ts
async loadSettings(): Promise<void> {
	const loaded = (await this.loadData()) as Partial<TodotxtMdSettings> | null;
	this.settings = {
		defaultPriority:
			loaded && isValidPriority(loaded.defaultPriority)
				? loaded.defaultPriority
				: DEFAULT_SETTINGS.defaultPriority,
		enableDateSuggest:
			loaded && typeof loaded.enableDateSuggest === "boolean"
				? loaded.enableDateSuggest
				: DEFAULT_SETTINGS.enableDateSuggest,
		scanFolders:
			loaded && isValidScanFolders(loaded.scanFolders)
				? loaded.scanFolders
				: DEFAULT_SETTINGS.scanFolders,
		defaultDueWindow:
			loaded && isValidDueWindow(loaded.defaultDueWindow)
				? loaded.defaultDueWindow
				: DEFAULT_SETTINGS.defaultDueWindow,
	};
}
```

- [ ] **Step 2: Register the view type and command in `onload`**

Add the import:

```ts
import { AggregatedTaskView, TASK_VIEW_TYPE } from "./view";
```

In `onload()`, after the date-suggest wiring from Task 3, add:

```ts
this.registerView(TASK_VIEW_TYPE, (leaf) => new AggregatedTaskView(leaf, this));

this.addCommand({
	id: "open-aggregated-view",
	name: "Open aggregated task view",
	callback: () => this.activateTaskView(),
});
```

- [ ] **Step 3: Add `activateTaskView` method to `TodotxtMdPlugin`**

```ts
async activateTaskView(): Promise<void> {
	const existing = this.app.workspace.getLeavesOfType(TASK_VIEW_TYPE);
	if (existing.length > 0) {
		await this.app.workspace.revealLeaf(existing[0]);
		return;
	}
	const leaf = this.app.workspace.getRightLeaf(false);
	if (!leaf) return;
	await leaf.setViewState({ type: TASK_VIEW_TYPE, active: true });
	await this.app.workspace.revealLeaf(leaf);
}
```

- [ ] **Step 4: Add settings-tab controls for `scanFolders` and `defaultDueWindow`**

In `TodotxtMdSettingTab.display()`, after the "Date shortcut suggestions" toggle from Task 3,
add:

```ts
new Setting(containerEl)
	.setName("Scan folders")
	.setDesc(
		"Folders to scan for the aggregated task view, one per line. Leave empty to scan the whole vault.",
	)
	.addTextArea((textArea) =>
		textArea.setValue(this.plugin.settings.scanFolders.join("\n")).onChange(async (value) => {
			const folders = value
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line.length > 0);
			this.plugin.settings.scanFolders = folders;
			await this.plugin.saveSettings();
		}),
	);

new Setting(containerEl)
	.setName("Default due window")
	.setDesc("Default due-date filter shown when the aggregated task view opens.")
	.addDropdown((dropdown) =>
		dropdown
			.addOptions({
				all: "All",
				overdue: "Overdue",
				today: "Today",
				"this-week": "This week",
				none: "No due date",
			})
			.setValue(this.plugin.settings.defaultDueWindow)
			.onChange(async (value) => {
				this.plugin.settings.defaultDueWindow = value as TodotxtMdSettings["defaultDueWindow"];
				await this.plugin.saveSettings();
			}),
	);
```

- [ ] **Step 5: Build and typecheck**

Run: `npm run build`
Expected: builds cleanly. This resolves Task 6 Step 3's deferred typecheck — `src/view.ts` now
has a complete `TodotxtMdSettings` shape to reference. If there are type errors referencing
`view.ts`, fix them here (e.g. confirm `AggregateFilter["dueWindow"]` cast matches `DueWindow`).

- [ ] **Step 6: Manually verify in the test vault**

Note: context/project (`#tag`/`+Project`) filtering has no UI control yet (deliberately
deferred per Task 6 Step 1's note) — `aggregateTasks`'s context/project filtering is unit-tested
in Task 5 but is NOT exercised manually here. Track that as an explicit follow-up task before
considering `PLAN.md` Verification item 5 ("filtering by `#context` and `+project` narrows the
list correctly") fully closed — due-window and include-done are the only filters verified live
by this checklist.

Rebuild and reload the plugin in the test vault
(`C:\Users\apdev\Documents\github\obsidian\test`), then:

1. Ensure tasks exist across at least two files (e.g. the existing `Welcome.md` Tasks section,
   plus create a second file `Work2.md` with a task or two).
2. Run "Open aggregated task view" from the command palette — a new pane should open (default:
   right sidebar) showing tasks from both files.
3. Change the "due window" dropdown to "Overdue" — the list should narrow to only tasks whose
   `due:` is before today.
4. Change it to "This week" — should show tasks due within the next 6 days plus today.
5. Toggle "Include done" — a completed (`- [x]`) task should appear/disappear accordingly.
6. Click a task in the list — the editor should open the correct file with the cursor on the
   exact source line of that task.
7. Edit a task's text directly in the editor (e.g. change its priority) and wait ~1 second —
   the aggregated view should refresh and reflect the change without manual action.
8. Close the view and reopen it via the command — confirm it doesn't error and re-scans
   correctly.
9. In Settings -> Todo.txt MD, set "Scan folders" to a single folder path, reopen the view, and
   confirm it only shows tasks from that folder; clear the setting and confirm it goes back to
   whole-vault scanning.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat: wire AggregatedTaskView into plugin with scan-scope and due-window settings"
```

---

### Task 8: Update `PLAN.md` verification checklist status

**Files:**
- Modify: `PLAN.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Confirm all manual verification steps from Tasks 3, 6, and 7 above pass**

Re-read `PLAN.md`'s Verification section (5 items) and confirm items 2 (date-token expansion,
now via the popup in addition to the existing command) and 5 (aggregated view) are both fully
exercised per the manual checklists in Task 3 Step 5 and Task 7 Step 6 above. **Known gap:**
Task 7 Step 6 does not manually verify context/project filtering (no UI control exists yet —
see Task 6 Step 1's note and Task 7 Step 6's note). Item 5's "filtering by `#context` and
`+project` narrows the list correctly" clause is therefore only unit-tested (Task 5), not
manually verified. Do not mark item 5 as fully closed until a follow-up adds the context/project
UI controls and this clause is re-checked live — flag this explicitly to whoever picks up that
follow-up rather than letting it quietly read as "done."

- [ ] **Step 2: Note completion in `PLAN.md` if the file tracks per-item status inline**

If `PLAN.md`'s verification section has no per-item checkbox/status markers already, skip this
step — the file describes the checklist procedure, not a running status log, and per this
project's convention (`DESIGN_RULES.md` section 7), changes to durable docs are made "in the
same commit as the code that depends on the change" only when a rule or claim actually changes.
Since this task doesn't change any rule or grammar claim, no `PLAN.md` edit is required unless
manual testing in Tasks 3/6/7 surfaces a behavior that contradicts something currently written
there (in which case, fix that specific claim, following the pattern already established in the
2026-09-20 edits to `PLAN.md`/`DECISIONS.md`).

- [ ] **Step 3: Final full-suite check**

Run: `npm test && npm run lint && npx tsc -noEmit -skipLibCheck && npm run build`
Expected: all green — 43+ pre-existing tests plus the new `suggestDateShortcuts`, `compareTasks`,
and `aggregate.ts` tests all pass; lint and typecheck clean; production build succeeds.

- [ ] **Step 4: Commit (only if Step 2 produced a `PLAN.md` change)**

```bash
git add PLAN.md
git commit -m "docs: reflect verified date-suggest popup and aggregated view behavior"
```
