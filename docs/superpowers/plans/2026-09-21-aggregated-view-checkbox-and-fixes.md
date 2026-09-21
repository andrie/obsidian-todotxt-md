# Aggregated View Checkbox + CTO Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real, both-directions checkbox to the aggregated task view so tasks can be
completed/uncompleted without opening the source file; fix two correctness bugs found in the
2026-09-21 CTO architectural review (`defaultPriority` setting silently unused, sort cursor
re-anchoring picks the wrong duplicate line); add `README.md` and `LICENSE` ahead of any public
release.

**Architecture:** Extract the pure toggle-done transform (currently inline in
`editor.ts`'s `toggleDoneAtCursor`) into a standalone `toggleDone(task, clock): Task` function
so both the cursor-based editor command and the aggregated view's checkbox click can call the
same logic. The view writes back via `app.vault.read` + line-splice + `app.vault.modify`
(no open `Editor` exists for files that aren't the active pane) and does a local, in-memory
mutation of the one affected `TaskRecord` for instant UI feedback, rather than waiting for the
debounced full vault rescan. The `defaultPriority` fix threads the existing (already-tested)
`bumpPriority` third parameter through `editor.ts` and `main.ts` — no new logic, just wiring.
The sort re-anchoring fix tracks the cursor's original *array index* through the sort instead of
relying on `indexOf` text matching.

**Tech Stack:** TypeScript (strict), Obsidian API, Vitest, esbuild. No new dependencies.

**Spec:** No separate spec document — this is bounded work against the existing `SPEC.md` /
`DESIGN_RULES.md` (see repo root) plus the checkbox design approved in-conversation on
2026-09-21 (aggregated-view checkbox: both-directions toggle, stays visible with
strikethrough/greyed styling after toggling rather than disappearing immediately).

## Global Constraints

- No emojis in stored task text or UI chrome (`DESIGN_RULES.md` §1.2).
- `src/parse.ts` is the only place that parses/emits task syntax — no ad-hoc regex elsewhere
  (`DESIGN_RULES.md` §2.1).
- Core modules (`parse`, `priority`, `dates`, `sort`, `aggregate`) stay Obsidian-free and
  unit-tested; `main.ts`/`editor.ts`/`view.ts`/`dateSuggest.ts` are thin Obsidian glue, manually
  verified (`DESIGN_RULES.md` §3.1, §5).
- Never call `new Date()` directly in core logic — always take an injected `Clock`
  (`DESIGN_RULES.md` §3.2).
- All editor rewrites go through Obsidian's `Editor`/CM6 transaction API, never raw string
  mutation of an open document (`SPEC.md` "Editor mechanics").
- Settings have safe defaults and are validated on load (`DESIGN_RULES.md` §4.4) — already true
  of `main.ts`'s `loadSettings`; don't regress it.
- `styles.css` stays deliberately minimal — plain text is the product (`styles.css:1`).

---

### Task 1: Extract `toggleDone` as a reusable pure-ish transform

**Files:**
- Modify: `src/editor.ts:112-135` (the existing `toggleDoneAtCursor` function)
- Test: `tests/editor.test.ts` (new file — `editor.ts` currently has no dedicated test file;
  this task adds one scoped to the new pure function only, not the `Editor`-dependent parts)

**Interfaces:**
- Consumes: `Task` and `serializeTask`/`parseTaskLine` from `src/parse.ts` (existing);
  `Clock`, `expandDateToken` from `src/dates.ts` (existing).
- Produces: `export function toggleDone(task: Task, clock: Clock): Task` — takes a parsed task,
  returns a new `Task` with `done`/`completionDate` toggled. Used by Task 2 (view checkbox) and
  by the existing `toggleDoneAtCursor`, which becomes a thin wrapper around it.

This function contains zero Obsidian types (no `Editor` import), so it is unit-testable exactly
like `bumpPriority` in `src/priority.ts` — follow that file's pattern.

- [ ] **Step 1: Write the failing test**

Create `tests/editor.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseTaskLine } from "../src/parse";
import { toggleDone } from "../src/editor";
import type { Clock } from "../src/dates";

const fixedClock: Clock = () => new Date(2026, 8, 19);

function task(raw: string) {
	const parsed = parseTaskLine(raw);
	if (!parsed) throw new Error("fixture line did not parse");
	return parsed;
}

describe("toggleDone", () => {
	it("marks a not-done task as done, prepending today's completion date", () => {
		const result = toggleDone(task("- [ ] (A) 2026-09-01 Call the bank"), fixedClock);
		expect(result.done).toBe(true);
		expect(result.completionDate).toBe("2026-09-19");
		expect(result.priority).toBe("A");
		expect(result.creationDate).toBe("2026-09-01");
	});

	it("marks a done task as not-done, clearing the completion date", () => {
		const result = toggleDone(task("- [x] 2026-09-19 (A) 2026-09-01 Call the bank"), fixedClock);
		expect(result.done).toBe(false);
		expect(result.completionDate).toBeNull();
		expect(result.priority).toBe("A");
	});

	it("leaves due: untouched when marking done", () => {
		const result = toggleDone(task("- [ ] Call the bank due:2026-09-25"), fixedClock);
		expect(result.due).toBe("2026-09-25");
	});

	it("does not mutate the input task", () => {
		const input = task("- [ ] Call the bank");
		toggleDone(input, fixedClock);
		expect(input.done).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/editor.test.ts`
Expected: FAIL — `toggleDone` is not exported from `../src/editor`.

- [ ] **Step 3: Extract the pure transform in `src/editor.ts`**

Replace the current `toggleDoneAtCursor` (lines 112-135) with:

```typescript
/**
 * Toggles done state on a Task, prepending/stripping the completion date per the todo.txt
 * convention. due:/t: are left untouched on completion (SPEC.md "Completion field handling")
 * — a completed task keeps its due date as a historical record. Pure: no Obsidian types, so
 * it's reusable by both the cursor-based command below and the aggregated view's checkbox
 * (view.ts), which has no open Editor to operate on.
 */
export function toggleDone(task: Task, clock: Clock): Task {
	return task.done
		? { ...task, done: false, completionDate: null }
		: { ...task, done: true, completionDate: expandDateToken("tod", clock) };
}

/**
 * Toggles done state on the cursor's line, via toggleDone. No-ops if the cursor isn't on a
 * task line.
 */
export function toggleDoneAtCursor(editor: Editor, clock: Clock): void {
	const found = currentLineTask(editor);
	if (!found) return;

	const { task, lineNumber } = found;
	const cursor = editor.getCursor();
	const before = serializeTask(task);

	const updated = toggleDone(task, clock);

	const after = serializeTask(updated);
	replaceLine(editor, lineNumber, after);

	const delta = after.length - before.length;
	const newCh = Math.max(0, cursor.ch + delta);
	editor.setCursor({ line: lineNumber, ch: newCh });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/editor.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full test suite to confirm no regression**

Run: `npm test`
Expected: all existing suites (`priority`, `dates`, `parse`, `sort`, `aggregate`) plus the new
`editor` suite pass — 70 tests total (66 existing + 4 new).

- [ ] **Step 6: Commit**

```bash
git add src/editor.ts tests/editor.test.ts
git commit -m "refactor: extract toggleDone as a pure, reusable transform"
```

---

### Task 2: Add a working checkbox to the aggregated view

**Files:**
- Modify: `src/view.ts:79-110` (`render`/`formatTaskLabel`), and add a new private method for
  the write-back.
- Modify: `styles.css` (add `.todotxt-md-task-item.is-done` styling).

**Interfaces:**
- Consumes: `toggleDone` from `src/editor.ts` (Task 1); `serializeTask`, `parseTaskLine` from
  `src/parse.ts`; existing `TaskRecord` type from `src/aggregate.ts`; `this.clock` (already a
  field on `AggregatedTaskView`, `view.ts:15,28`); `this.app.vault.read`/`.modify` (Obsidian
  vault API).
- Produces: no new exports — this is leaf UI wiring, manually verified in Obsidian per
  `DESIGN_RULES.md` §3.1 (view.ts is glue, not core).

This task is not unit-tested (consistent with `view.ts`'s existing testing stance — see
`SPEC.md` "Testing" and `DESIGN_RULES.md` §5.1-5.2: core logic is unit-tested, Obsidian glue is
manually verified). Steps below are manual-verification steps in the test vault
(`C:\Users\apdev\Documents\github\obsidian\test`, plugin symlinked at
`.obsidian\plugins\todotxt-md`), not automated test steps.

- [ ] **Step 1: Replace `render`'s item-building loop in `src/view.ts`**

Replace lines 93-99 (the `for (const record of visible)` loop inside `render`) with:

```typescript
		for (const record of visible) {
			const item = listEl.createDiv({ cls: "todotxt-md-task-item" });
			if (record.task.done) item.addClass("is-done");

			const checkbox = item.createEl("input", { type: "checkbox" });
			checkbox.checked = record.task.done;
			checkbox.addEventListener("click", (evt) => {
				evt.stopPropagation();
				void this.toggleRecordDone(record);
			});

			const label = item.createSpan({ text: this.formatTaskLabel(record) });
			label.addEventListener("click", () => {
				void this.jumpToTask(record);
			});
		}
```

- [ ] **Step 2: Add the write-back method to `AggregatedTaskView` in `src/view.ts`**

Add this new private method, placed after `jumpToTask` (end of the class, before the closing
brace at line 157):

```typescript
	private async toggleRecordDone(record: TaskRecord): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(record.filePath);
		if (!(file instanceof TFile)) return;

		const content = await this.app.vault.read(file);
		const lines = content.split("\n");
		const lineText = lines[record.line];
		const task = parseTaskLine(lineText);
		if (!task) return;

		const updated = toggleDone(task, this.clock);
		lines[record.line] = serializeTask(updated);
		await this.app.vault.modify(file, lines.join("\n"));

		record.task = updated;
		this.render();
	}
```

- [ ] **Step 3: Add the two new imports to the top of `src/view.ts`**

Update the existing import lines (1-5) to add `toggleDone` and `serializeTask`:

```typescript
import { ItemView, WorkspaceLeaf, TFile, debounce, type Editor } from "obsidian";
import type TodotxtMdPlugin from "./main";
import { parseTaskLine, serializeTask } from "./parse";
import { toggleDone } from "./editor";
import { aggregateTasks, DEFAULT_FILTER, type AggregateFilter, type TaskRecord } from "./aggregate";
import type { Clock } from "./dates";
```

- [ ] **Step 4: Add minimal styling in `styles.css`**

Append after the existing `.todotxt-md-task-item:hover` block (after line 29):

```css
.todotxt-md-task-item input[type="checkbox"] {
	margin-right: 0.5em;
}

.todotxt-md-task-item.is-done {
	color: var(--text-muted);
	text-decoration: line-through;
}
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: builds cleanly, no TypeScript errors (in particular: `record.task = updated`
requires `TaskRecord.task` to not be `readonly` — confirm `src/aggregate.ts:11-16`'s
`TaskRecord` interface has no `readonly` modifiers; it doesn't, per the current source, so no
type change is needed).

- [ ] **Step 6: Manually verify in the test vault**

In `C:\Users\apdev\Documents\github\obsidian\test` (plugin already symlinked, per project
memory), reload the "Todo.txt MD" plugin to pick up the new build, then:
1. Add at least two `- [ ]` tasks across two files (e.g. `Work.md` and a daily note).
2. Open the aggregated view (command: "Open aggregated task view").
3. Confirm each task row now shows a checkbox before its label.
4. Click a checkbox on a not-done task — confirm: the row gets strikethrough/greyed styling
   immediately (no need to wait for a rescan), and the source file's raw text now has a
   completion date prepended (open the file to confirm).
5. Click the same checkbox again — confirm: strikethrough clears, and the completion date is
   removed from the source file.
6. Click on the task's label text (not the checkbox) — confirm this still jumps to the source
   line (the existing `jumpToTask` behavior must be unaffected).
7. Confirm clicking the checkbox does *not* also trigger a jump (this is what
   `evt.stopPropagation()` in Step 1 prevents — verify it actually doesn't navigate).

- [ ] **Step 7: Commit**

```bash
git add src/view.ts styles.css
git commit -m "feat: add working checkbox to aggregated task view"
```

---

### Task 3: Fix dead `defaultPriority` setting

**Files:**
- Modify: `src/editor.ts` (`bumpPriorityAtCursor`, currently lines 33-48 before Task 1's edits
  shift line numbers slightly — locate by function name, not line number, when executing this
  task after Task 1/2).
- Modify: `src/main.ts:62-72` (the `increase-priority`/`decrease-priority` command
  registrations).
- Test: `tests/editor.test.ts` (extend the file created in Task 1).

**Interfaces:**
- Consumes: `bumpPriority(task, direction, defaultPriority?)` from `src/priority.ts` — already
  exists and is already tested (`tests/priority.test.ts:17-20`); this task only wires the third
  argument through, it does not change `priority.ts`.
- Produces: `bumpPriorityAtCursor(editor: Editor, direction: 1 | -1, defaultPriority: string):
  void` — signature gains a required third parameter (no default value, so every call site must
  be updated deliberately rather than silently keeping the old behavior).

**Root cause:** `main.ts:65,71` calls `bumpPriorityAtCursor(editor, direction)` with no third
argument, and `editor.ts`'s `bumpPriorityAtCursor` calls `bumpPriority(task, direction)` — also
with no third argument — so `priority.ts`'s own default (`"A"`) is always used regardless of
the `defaultPriority` setting configured in the settings tab (`main.ts:146-157`).

- [ ] **Step 1: Write the failing test**

Add to `tests/editor.test.ts` (same file from Task 1), a new `describe` block:

```typescript
import { bumpPriorityAtCursor } from "../src/editor";

// ... (existing imports/fixtures from Task 1 stay)

describe("bumpPriorityAtCursor", () => {
	function fakeEditor(line: string) {
		let text = line;
		let cursor = { line: 0, ch: 0 };
		return {
			getCursor: () => cursor,
			getLine: (n: number) => (n === 0 ? text : ""),
			replaceRange: (newText: string) => {
				text = newText;
			},
			setCursor: (pos: { line: number; ch: number }) => {
				cursor = pos;
			},
			getText: () => text,
		};
	}

	it("passes the configured default priority through when increasing from none", () => {
		const editor = fakeEditor("- [ ] Call the bank");
		bumpPriorityAtCursor(editor as never, -1, "C");
		expect(editor.getText()).toContain("(C)");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/editor.test.ts`
Expected: FAIL — `bumpPriorityAtCursor` does not accept a third argument yet (TypeScript type
error at the call site, or the test's expectation fails since `(C)` isn't in the output — either
failure mode confirms the bug).

- [ ] **Step 3: Update `bumpPriorityAtCursor` in `src/editor.ts`**

Find the current `bumpPriorityAtCursor` function and change its signature and body:

```typescript
export function bumpPriorityAtCursor(
	editor: Editor,
	direction: 1 | -1,
	defaultPriority: string,
): void {
	const found = currentLineTask(editor);
	if (!found) return;

	const { task, lineNumber } = found;
	const cursor = editor.getCursor();
	const before = serializeTask(task);
	const updated = bumpPriority(task, direction, defaultPriority);
	const after = serializeTask(updated);

	replaceLine(editor, lineNumber, after);

	const delta = after.length - before.length;
	const newCh = Math.max(0, cursor.ch + delta);
	editor.setCursor({ line: lineNumber, ch: newCh });
}
```

(Only the `bumpPriority(task, direction)` call and the function signature change — the rest of
the function body is unchanged.)

- [ ] **Step 4: Update the two call sites in `src/main.ts`**

Replace lines 62-72:

```typescript
		this.addCommand({
			id: "increase-priority",
			name: "Increase priority",
			editorCallback: (editor) =>
				bumpPriorityAtCursor(editor, -1, this.settings.defaultPriority),
		});

		this.addCommand({
			id: "decrease-priority",
			name: "Decrease priority",
			editorCallback: (editor) =>
				bumpPriorityAtCursor(editor, 1, this.settings.defaultPriority),
		});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/editor.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite and build**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds with no TypeScript errors (confirms no other call site
of `bumpPriorityAtCursor` was missed — TypeScript will error on any other 2-argument call site
now that the third parameter is required).

- [ ] **Step 7: Manually verify in the test vault**

In the test vault, open the settings tab for "Todo.txt MD", change "Default priority" to `C`,
then on a task with no priority, run "Increase priority" — confirm it becomes `(C)`, not `(A)`.

- [ ] **Step 8: Commit**

```bash
git add src/editor.ts src/main.ts tests/editor.test.ts
git commit -m "fix: thread defaultPriority setting through to bumpPriority"
```

---

### Task 4: Fix sort cursor re-anchoring for duplicate lines

**Files:**
- Modify: `src/editor.ts` (`sortBlockAtCursor`).
- Test: `tests/editor.test.ts` (extend further).

**Interfaces:**
- Consumes: `sortLines` from `src/sort.ts` (unchanged).
- Produces: no signature change to `sortBlockAtCursor(editor: Editor): void` — internal fix
  only.

**Root cause:** the current implementation re-anchors the cursor with
`sorted.indexOf(originalLineText)` (`src/editor.ts`, inside `sortBlockAtCursor`). If two lines in
the block are textually identical, `indexOf` always returns the *first* match, which may not be
the line the cursor was actually on — the cursor can silently jump to the wrong duplicate line
after a sort.

**Fix approach:** track the cursor's position by original array index through a stable sort,
using a wrapper that pairs each line with its original index, sorting by the existing comparator
on the line text, and reading back which original index ended up at which new position.

- [ ] **Step 1: Write the failing test**

Add to `tests/editor.test.ts`:

```typescript
import { sortBlockAtCursor } from "../src/editor";

describe("sortBlockAtCursor", () => {
	function fakeEditor(lines: string[], cursorLine: number) {
		let content = lines;
		let cursor = { line: cursorLine, ch: 3 };
		return {
			getCursor: () => cursor,
			getLine: (n: number) => content[n] ?? "",
			lastLine: () => content.length - 1,
			replaceRange: (newText: string, from: { line: number }, to: { line: number }) => {
				const replacement = newText.split("\n");
				content = [
					...content.slice(0, from.line),
					...replacement,
					...content.slice(to.line + 1),
				];
			},
			setCursor: (pos: { line: number; ch: number }) => {
				cursor = pos;
			},
			getContent: () => content,
			getFinalCursor: () => cursor,
		};
	}

	it("re-anchors the cursor to the same line index when two lines are identical text", () => {
		// Both "- [ ] (B) dup" lines are textually identical; cursor starts on the SECOND one
		// (index 2). A naive indexOf-based re-anchor would always find the FIRST "(B) dup" line
		// after sorting, which is index 1 post-sort (still identical text) -- so this test needs
		// distinguishing context to actually prove which physical line moved where. Use two
		// distinct-priority lines plus one duplicate pair, and assert the duplicate cursor line's
		// *relative order among duplicates* is preserved (index 2 of the original 3 duplicate-free
		// entries maps deterministically under a stable sort).
		const lines = [
			"- [ ] (B) dup",
			"- [ ] (A) unique",
			"- [ ] (B) dup",
		];
		const editor = fakeEditor(lines, 2); // cursor starts on the SECOND "(B) dup" line
		sortBlockAtCursor(editor as never);

		// After sorting: [(A) unique, (B) dup, (B) dup] -- the two "(B) dup" lines keep their
		// relative order (stable sort), so the SECOND original "(B) dup" (the one the cursor was
		// on) is now at index 2, not index 1.
		expect(editor.getContent()).toEqual([
			"- [ ] (A) unique",
			"- [ ] (B) dup",
			"- [ ] (B) dup",
		]);
		expect(editor.getFinalCursor().line).toBe(2);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/editor.test.ts`
Expected: FAIL — the current `indexOf`-based implementation anchors to line 1 (the first
duplicate), not line 2 (where the cursor actually was).

- [ ] **Step 3: Fix `sortBlockAtCursor` in `src/editor.ts`**

Replace the current implementation with one that sorts `{ text, originalIndex }` pairs instead
of bare strings, using `sortLines`' comparator indirectly via `parseTaskLine`/`compareLines`
semantics — but since `sortLines` only accepts `string[]`, wrap by sorting an array of indices
using the same comparator logic. Import `compareLines`-equivalent behavior by sorting indices
with a comparator that looks up the text:

```typescript
export function sortBlockAtCursor(editor: Editor): void {
	const cursor = editor.getCursor();
	const lastLine = editor.lastLine();
	const originalCursorLine = cursor.line;

	if (!parseTaskLine(editor.getLine(cursor.line))) return;

	let start = cursor.line;
	while (start > 0 && parseTaskLine(editor.getLine(start - 1))) {
		start--;
	}
	let end = cursor.line;
	while (end < lastLine && parseTaskLine(editor.getLine(end + 1))) {
		end++;
	}

	const blockLines: string[] = [];
	for (let i = start; i <= end; i++) {
		blockLines.push(editor.getLine(i));
	}

	const indices = blockLines.map((_, i) => i);
	const sortedIndices = [...indices].sort(
		(i, j) => defaultComparator(blockLines[i], blockLines[j]),
	);
	const sorted = sortedIndices.map((i) => blockLines[i]);
	const newRelativeIndex = sortedIndices.indexOf(originalCursorLine - start);

	editor.replaceRange(
		sorted.join("\n"),
		{ line: start, ch: 0 },
		{ line: end, ch: editor.getLine(end).length },
	);

	if (newRelativeIndex !== -1) {
		editor.setCursor({ line: start + newRelativeIndex, ch: cursor.ch });
	}
}
```

Add `defaultComparator` to the existing `import { sortLines } from "./sort";` line in
`src/editor.ts`, i.e. change it to `import { sortLines, defaultComparator } from "./sort";`.
`defaultComparator` is already exported from `src/sort.ts` (aliased from `compareLines`) — no
change needed in `sort.ts` itself.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/editor.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all suites pass, including the existing (unmodified) sort-related assertions in
`tests/sort.test.ts` (that file tests `sortLines`/`compareTasks` directly and is untouched by
this task).

- [ ] **Step 6: Manually verify in the test vault**

Create a checkbox block with two textually-identical lines (e.g. two `- [ ] (B) dup` lines) and
one other task, place the cursor on the *second* duplicate, run "Sort current checkbox block",
and confirm the cursor lands on the duplicate that was originally under the cursor in its new
sorted position (relative order among duplicates preserved) rather than jumping to the first
duplicate.

- [ ] **Step 7: Commit**

```bash
git add src/editor.ts tests/editor.test.ts
git commit -m "fix: re-anchor sort cursor by original index, not indexOf text match"
```

---

### Task 5: Add `README.md` and `LICENSE`

**Files:**
- Create: `README.md`
- Create: `LICENSE`

**Interfaces:** None — documentation only, no code.

- [ ] **Step 1: Create `LICENSE`**

`package.json:18` already declares `"license": "MIT"`. Create `LICENSE` with the standard MIT
license text, author "Andrie de Vries" (matching `manifest.json:7`'s `author` field), year 2026:

```
MIT License

Copyright (c) 2026 Andrie de Vries

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Create `README.md`**

Base the content on `SPEC.md`'s "Context" and "v1 scope" sections (already-approved product
description — this step summarizes existing docs for an external audience, it does not invent
new claims):

```markdown
# Todo.txt MD

A clean, keyboard-driven, emoji-free todo.txt layer over Markdown checkboxes in Obsidian.

Create a task anywhere as a normal `- [ ]` checkbox and get todo.txt ergonomics — priority
hotkeys, quick date entry, in-place sorting, an aggregated cross-file task view — without the
emoji clutter of the Tasks or Task Genius plugins.

## Features

- **Priority hotkeys** — bump a task's priority (`(A)`-`(Z)`) up or down with a keystroke.
- **Quick date entry** — type `due:tod`, `due:mon`, `due:+3d` and get a live suggestion popup
  that expands it to an ISO date (`2026-09-19`); an explicit "Expand date token" command is also
  available.
- **In-place sort** — sort the checkbox block under your cursor by priority, then due date, then
  creation date.
- **Toggle done** — mark a task complete (or back to incomplete), with the completion date
  handled automatically per the todo.txt convention.
- **Aggregated task view** — a sortable, filterable list of every task across your vault
  (or a configured set of folders), filterable by due-date window and done state, with a
  checkbox to complete/uncomplete tasks directly from the list and click-to-jump to the source
  line.

## Task syntax

```
- [ ] (A) 2026-09-19 Call the bank about the loan +Finance #calls due:2026-09-25
      prio  creation date       description         project  context   due date
```

- Priority: `(A)`-`(Z)`, immediately after the checkbox.
- Projects: `+ProjectName`.
- Contexts: `#tag` (uses Obsidian-native tags, rather than todo.txt's `@context`, so the tag
  pane and search work automatically).
- Dates: ISO `YYYY-MM-DD`. `due:` and `t:` (threshold/start date) use todo.txt's own documented
  `key:value` extension convention.

Tasks remain fully legible, editable, and portable as plain Markdown — with or without this
plugin installed.

## Installation

1. Download the latest release.
2. Extract `main.js`, `manifest.json`, and `styles.css` into
   `<your-vault>/.obsidian/plugins/todotxt-md/`.
3. Enable "Todo.txt MD" in Obsidian's Community Plugins settings.

## Settings

- **Default priority** — priority assigned when increasing priority from none.
- **Date shortcut suggestions** — toggle the live popup after typing `due:`/`t:`.
- **Scan folders** — restrict the aggregated view to specific folders (default: whole vault).
- **Default due window** — the due-date filter shown when the aggregated view first opens.

## Development

```bash
npm install
npm run dev      # esbuild watch mode
npm test         # Vitest unit tests
npm run lint      # ESLint + Prettier check
npm run build     # type-check + production build
```

See `SPEC.md` and `DESIGN_RULES.md` in this repository for the full grammar contract and
architectural rules.

## License

MIT — see `LICENSE`.
```

- [ ] **Step 3: Commit**

```bash
git add README.md LICENSE
git commit -m "docs: add README and LICENSE ahead of public release"
```

---

## Self-Review Notes

- **Spec coverage:** all four approved items (checkbox feature, defaultPriority fix, sort
  re-anchor fix, README+LICENSE) each have a task. CI workflow and pinning the `obsidian`
  dependency were explicitly excluded from this pass per the user's scoping decision and are
  intentionally absent from this plan.
- **Type consistency:** `toggleDone(task: Task, clock: Clock): Task` (Task 1) is the exact
  signature consumed by Task 2's `toggleRecordDone`. `bumpPriorityAtCursor`'s new required third
  parameter (Task 3) is a breaking signature change *within this same plan* — Task 3 must run
  after Task 1 is committed but has no ordering dependency on Task 2; Tasks 3 and 4 both touch
  `src/editor.ts` and should run sequentially (3 then 4, or 4 then 3) to avoid merge conflicts
  within the same session, not in parallel.
- **Placeholder scan:** no "TBD"/"handle edge cases"-style steps; every code step has literal
  code.
