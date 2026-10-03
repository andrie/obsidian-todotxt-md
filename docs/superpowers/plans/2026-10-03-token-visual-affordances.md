# Token Visual Affordances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `+project`/`#context` tokens a visible, consistent color identity — as clickable
filter pills in the aggregated task view, and as colored decorations inside the note editor —
without changing the stored grammar or `parse.ts`'s parsing behavior.

**Architecture:** One new pure color-hash module (`src/tokenColors.ts`) is shared by two
independent consumers: (1) `view.ts`'s aggregated task list, rebuilt to render structured pill
elements instead of one flat text string, with click-to-filter wired into the already-implemented
`AggregateFilter.projects`/`.contexts` AND-logic in `aggregate.ts`; (2) a new CM6
`ViewPlugin` (`src/highlight.ts`) that decorates live editor text, fed by a new
`parseTaskLineWithSpans`/`detectMalformedPriority` pair added to `parse.ts` to recover token
character offsets that `parseTaskLine` computes internally but doesn't expose today.

**Tech Stack:** TypeScript (strict), Obsidian Plugin API, CodeMirror 6 (`@codemirror/view`,
re-exported through the `obsidian` package's bundled CM6, matching how `dateSuggest.ts` already
uses `EditorSuggest`), Vitest.

**Spec:**
- `docs/superpowers/specs/2026-10-03-aggregated-view-pills-and-filters-design.md`
- `docs/superpowers/specs/2026-09-21-in-editor-highlighting-design.md` (as amended 2026-10-03)

## Global Constraints

- No `any` in core modules (`parse.ts`, `tokenColors.ts`); model types explicitly
  (`DESIGN_RULES.md` §4.1).
- `parse.ts` remains the only module that parses/emits task syntax with grammar-aware regex;
  `tokenColors.ts` and `highlight.ts` consume `Task`/`TokenSpan`, never re-derive grammar
  (`DESIGN_RULES.md` §2.1).
- `tokenColors.ts` is pure core: importable and testable from plain Node, no `obsidian` import
  (`DESIGN_RULES.md` §3.1).
- Never call `new Date()` directly in core logic — not applicable to this plan's modules (no
  date logic is added), but any clock usage introduced must take an injected `Clock`
  (`DESIGN_RULES.md` §3.2).
- Settings have safe defaults and are validated on load; a missing/malformed stored value falls
  back to the default rather than throwing (`DESIGN_RULES.md` §4.4) — applies to both new
  settings (`enableAggregatedViewPills`, `enableInEditorHighlight`).
- Both new features default to **on** (`true`) per the approved design.
- `formatTaskLabel`/pill rendering and the CM6 decoration extension are two independent render
  paths; they must not share a "compute styled spans" function — only `tokenColors.ts`'s
  `nameToColor` is shared (per spec's "Two independent render paths" decision).
- Project/context colors come only from `nameToColor`'s fixed palette — no Style
  Settings-overridable color for these two token kinds (per spec's "per-name hash, not Style
  Settings-configurable" decision). Style Settings remains the mechanism for date/done-line/
  malformed-priority colors.

## Review Focus

- **Empty project/context names never produce a pill or a decoration.** `parse.ts`'s existing
  `word.length > 1` guard already prevents a bare `"+"` or `"#"` from entering `projects`/
  `contexts`, but a reviewer should confirm `tokenColors.ts`'s `nameToColor("")` doesn't throw if
  ever called directly, and that no code path calls it with an empty string from real data.
- **Clicking a pill must not also jump to the task's source line.** `view.ts`'s row click
  handler (`jumpToTask`) is on the whole row; forgetting `stopPropagation()` on a pill's click
  listener silently files every filter-click as a navigation instead.
- **Toggling a project/context filter off (via chip removal) must restore all previously-hidden
  matching tasks**, not just stop hiding new ones — i.e. `this.filter.projects`/`.contexts`
  must actually be spliced, not just visually unmarked, or `aggregateTasks` keeps filtering on
  stale state.
- **A line with a malformed leading priority token AND a valid trailing `+project`/`#context`
  must still get its project/context decorated** — `detectMalformedPriority` and
  `parseTaskLineWithSpans` must both run per line; one returning a signal must never suppress
  the other, since a user's invalid priority attempt ("[A] Call bank +Finance") shouldn't also
  hide the `+Finance` highlight they're relying on for the scanning benefit.
- **A done task's whole-line `todotxt-md-hl-done-line` decoration must not visually fight with
  per-token colors** — a reviewer should manually check in Obsidian that a done task with a
  `+project` token still shows the project color readably against the done-line styling
  (e.g. not identical muted colors both resulting in invisible text), since this interaction
  isn't covered by any unit test (DOM/CM6 rendering is manual-only per both specs' Testing
  sections).

---

## Task 1: `src/tokenColors.ts` — shared deterministic color hash

**Files:**
- Create: `src/tokenColors.ts`
- Test: `tests/tokenColors.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no imports from `obsidian` or other project modules).
- Produces: `nameToColor(name: string): string` — returns a hex color string (e.g.
  `"#4C78A8"`) from a fixed internal palette. Later tasks (`view.ts`, `highlight.ts`) import
  this function by name.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/tokenColors.test.ts
import { describe, expect, it } from "vitest";
import { nameToColor } from "../src/tokenColors";

describe("nameToColor", () => {
	it("is deterministic for the same name", () => {
		expect(nameToColor("Finance")).toBe(nameToColor("Finance"));
		expect(nameToColor("calls")).toBe(nameToColor("calls"));
	});

	it("returns a hex color string", () => {
		expect(nameToColor("Finance")).toMatch(/^#[0-9A-Fa-f]{6}$/);
	});

	it("spreads across more than one palette slot for distinct names", () => {
		const names = [
			"Finance",
			"Errands",
			"calls",
			"Admin",
			"Home",
			"Work",
			"Health",
			"Travel",
			"Shopping",
			"Family",
		];
		const colors = new Set(names.map(nameToColor));
		expect(colors.size).toBeGreaterThan(1);
	});

	it("does not throw on empty string or unicode names", () => {
		expect(() => nameToColor("")).not.toThrow();
		expect(nameToColor("")).toMatch(/^#[0-9A-Fa-f]{6}$/);
		expect(() => nameToColor("日本語")).not.toThrow();
		expect(() => nameToColor("café")).not.toThrow();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tokenColors.test.ts`
Expected: FAIL — `Cannot find module '../src/tokenColors'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
// src/tokenColors.ts

/**
 * Fixed palette, pre-checked to read acceptably against both Obsidian's default light and
 * dark theme backgrounds. Shared by the aggregated view's pills (view.ts) and the in-editor
 * decoration extension (highlight.ts) so a given project/context name renders as the same
 * color in both surfaces. Not user-configurable (see the aggregated-view design spec's
 * "per-name hash, not Style Settings-configurable" decision).
 */
const PALETTE: readonly string[] = [
	"#4C78A8", // blue
	"#F58518", // orange
	"#54A24B", // green
	"#B279A2", // purple
	"#E45756", // red
	"#72B7B2", // teal
	"#EECA3B", // yellow
	"#9D755D", // brown
	"#FF9DA6", // pink
	"#BAB0AC", // gray
];

/**
 * Simple, fast, stable string hash (FNV-1a variant). No cryptographic requirement — only
 * determinism (same name always maps to the same palette slot) and a reasonable spread across
 * typical project/context name sets.
 */
function hashString(value: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/** Deterministic: the same name always maps to the same palette entry. */
export function nameToColor(name: string): string {
	const index = hashString(name) % PALETTE.length;
	return PALETTE[index];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tokenColors.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tokenColors.ts tests/tokenColors.test.ts
git commit -m "feat: add shared nameToColor hash for project/context tokens"
```

---

## Task 2: `view.ts` — structured pill rendering (no filtering yet)

**Files:**
- Modify: `src/view.ts:124-133` (replace `formatTaskLabel`), `src/view.ts:106-121` (the render
  loop that currently calls it)
- Test: manual only, per the existing spec's testing posture for `view.ts` — this task has no
  new unit tests; Task 3 adds the filter-logic wiring, which is unit-testable via `aggregate.ts`
  (already covered) plus manual verification of the click path.

**Interfaces:**
- Consumes: `nameToColor` from `src/tokenColors.ts` (Task 1). `TaskRecord` from
  `src/aggregate.ts` (existing, unchanged).
- Produces: `renderTaskRow(container: HTMLElement, record: TaskRecord): void` — appended to the
  `AggregatedTaskView` class, replacing the `formatTaskLabel` + `createSpan` call in `render()`.
  Later tasks (Task 3) extend this same method to attach click listeners to the pill elements it
  creates.

- [ ] **Step 1: Replace `formatTaskLabel` with `renderTaskRow` in `src/view.ts`**

Delete the existing `formatTaskLabel` method (`src/view.ts:124-133`) and the two lines in
`render()` that call it (`src/view.ts:117-120`):

```typescript
const label = item.createSpan({ text: this.formatTaskLabel(record) });
label.addEventListener("click", () => {
	void this.jumpToTask(record);
});
```

Replace with a call to a new method, keeping the row-level jump-to-source click behavior on the
row itself (not the label span) so later pill click handlers can `stopPropagation()` against it:

```typescript
item.addEventListener("click", () => {
	void this.jumpToTask(record);
});
this.renderTaskRow(item, record);
```

Add the new method (replacing the deleted `formatTaskLabel`):

```typescript
import { nameToColor } from "./tokenColors";

// ... inside AggregatedTaskView class:

private renderTaskRow(container: HTMLElement, record: TaskRecord): void {
	const { task } = record;

	if (task.priority) {
		container.createSpan({ text: `(${task.priority})`, cls: "todotxt-md-pill-priority" });
		container.appendText(" ");
	}
	if (task.creationDate) {
		container.createSpan({ text: task.creationDate, cls: "todotxt-md-date-segment" });
		container.appendText(" ");
	}
	container.createSpan({
		text: task.description || "(no description)",
		cls: "todotxt-md-description",
	});

	for (const project of task.projects) {
		container.appendText(" ");
		const pill = container.createSpan({
			text: `+${project}`,
			cls: "todotxt-md-pill todotxt-md-pill-project",
		});
		pill.style.color = nameToColor(project);
	}
	for (const context of task.contexts) {
		container.appendText(" ");
		const pill = container.createSpan({
			text: `#${context}`,
			cls: "todotxt-md-pill todotxt-md-pill-context",
		});
		pill.style.color = nameToColor(context);
	}

	if (task.due) {
		container.appendText(` due:${task.due}`);
	}
	container.appendText(` - ${record.filePath}`);
}
```

- [ ] **Step 2: Add CSS for the new classes to `styles.css`**

```css
.todotxt-md-pill {
	font-weight: 600;
	padding: 0 0.3em;
	border-radius: 0.3em;
}

.todotxt-md-pill-priority {
	font-weight: 700;
}

.todotxt-md-description {
	/* No special styling — plain description text, distinct class only so pills can be
	   targeted independently in CSS without affecting description text. */
}

.todotxt-md-date-segment {
	color: var(--text-muted);
}
```

- [ ] **Step 3: Build and manually verify in Obsidian**

Run: `npm run build`

In the test vault (see memory: sibling `obsidian/test` directory, symlinked plugin folder,
`Welcome.md` scratch note), add a task line with both a project and a context, e.g.:
`- [ ] (A) 2026-10-03 Call the bank +Finance #calls due:2026-10-10`. Open the aggregated task
view (command "Open aggregated task view"). Confirm:
- The row shows the priority, description, a colored `+Finance` pill, a colored `#calls` pill,
  the due date, and the file path, in that order.
- Clicking anywhere on the row (not yet on a pill specifically — pill click handling is Task 3)
  still jumps to the source line as before.

- [ ] **Step 4: Commit**

```bash
git add src/view.ts styles.css
git commit -m "feat: render aggregated-view task rows as structured pills"
```

---

## Task 3: `view.ts` + `aggregate.ts` wiring — click-to-filter and chip bar

**Files:**
- Modify: `src/view.ts:91` (`renderFilterControls` call site, unchanged signature), `src/view.ts`
  (extend `renderTaskRow` from Task 2, extend `renderFilterControls`)
- Test: `tests/aggregate.test.ts` — confirm existing coverage of
  `AggregateFilter.projects`/`.contexts` AND-semantics already exists (it does, per
  `src/aggregate.ts:79-80`); no new `aggregate.ts` test is needed since this task only adds a UI
  path to populate already-tested fields. Manual verification covers the UI wiring itself.

**Interfaces:**
- Consumes: `AggregateFilter` (existing, from `src/aggregate.ts`), `renderTaskRow` (Task 2).
- Produces: clicking a pill toggles membership in `this.filter.projects`/`.contexts`; a new
  private method `renderActiveFilterChips(container: HTMLElement): void` renders removable
  chips, called from `renderFilterControls`.

- [ ] **Step 1: Confirm existing filter-logic test coverage (no new test needed)**

Read `tests/aggregate.test.ts` and confirm it already exercises `AggregateFilter.projects`/
`.contexts` AND semantics (it does — `aggregate.ts:79-80`'s `filter.contexts.some(...)` /
`filter.projects.some(...)` logic predates this plan). This step is a confirmation only; skip
writing a new test here since the behavior under test does not change.

Run: `npx vitest run tests/aggregate.test.ts`
Expected: PASS (pre-existing, unaffected by this plan).

- [ ] **Step 2: Wire pill clicks to toggle the filter, in `src/view.ts`**

Extend `renderTaskRow` (Task 2) so each pill gets a click listener. Replace the project/context
pill-creation blocks with:

```typescript
for (const project of task.projects) {
	container.appendText(" ");
	const pill = container.createSpan({
		text: `+${project}`,
		cls: "todotxt-md-pill todotxt-md-pill-project",
	});
	pill.style.color = nameToColor(project);
	pill.addEventListener("click", (evt) => {
		evt.stopPropagation();
		this.toggleProjectFilter(project);
	});
}
for (const context of task.contexts) {
	container.appendText(" ");
	const pill = container.createSpan({
		text: `#${context}`,
		cls: "todotxt-md-pill todotxt-md-pill-context",
	});
	pill.style.color = nameToColor(context);
	pill.addEventListener("click", (evt) => {
		evt.stopPropagation();
		this.toggleContextFilter(context);
	});
}
```

Add two private methods to `AggregatedTaskView`:

```typescript
private toggleProjectFilter(project: string): void {
	const index = this.filter.projects.indexOf(project);
	const projects =
		index === -1
			? [...this.filter.projects, project]
			: this.filter.projects.filter((p) => p !== project);
	this.filter = { ...this.filter, projects };
	this.render();
}

private toggleContextFilter(context: string): void {
	const index = this.filter.contexts.indexOf(context);
	const contexts =
		index === -1
			? [...this.filter.contexts, context]
			: this.filter.contexts.filter((c) => c !== context);
	this.filter = { ...this.filter, contexts };
	this.render();
}
```

- [ ] **Step 3: Add the active-filters chip bar to `renderFilterControls`**

Extend `renderFilterControls` (after the existing "Include done" checkbox block) with:

```typescript
this.renderActiveFilterChips(controls);
```

Add the new method:

```typescript
private renderActiveFilterChips(container: HTMLElement): void {
	const chipBar = container.createDiv({ cls: "todotxt-md-active-filters" });

	for (const project of this.filter.projects) {
		const chip = chipBar.createSpan({ cls: "todotxt-md-filter-chip" });
		chip.createSpan({ text: `+${project}` });
		const remove = chip.createSpan({ text: " ×", cls: "todotxt-md-filter-chip-remove" });
		remove.addEventListener("click", () => this.toggleProjectFilter(project));
	}
	for (const context of this.filter.contexts) {
		const chip = chipBar.createSpan({ cls: "todotxt-md-filter-chip" });
		chip.createSpan({ text: `#${context}` });
		const remove = chip.createSpan({ text: " ×", cls: "todotxt-md-filter-chip-remove" });
		remove.addEventListener("click", () => this.toggleContextFilter(context));
	}
}
```

- [ ] **Step 4: Add CSS for the chip bar to `styles.css`**

```css
.todotxt-md-active-filters {
	display: flex;
	gap: 0.3em;
	flex-wrap: wrap;
}

.todotxt-md-filter-chip {
	background-color: var(--background-modifier-hover);
	border-radius: 0.3em;
	padding: 0.1em 0.4em;
}

.todotxt-md-filter-chip-remove {
	cursor: pointer;
	color: var(--text-muted);
}
```

- [ ] **Step 5: Build and manually verify in Obsidian**

Run: `npm run build`

In the test vault, with tasks tagged `+Finance`, `+Errands`, `#calls` across a couple of lines:
- Click the `+Finance` pill on a task row. Confirm: the list narrows to only tasks with
  `+Finance`, a chip reading `+Finance ×` appears in the filter-controls bar, and clicking the
  row elsewhere (not on the pill) did *not* also fire — i.e. clicking the pill did not jump to
  source.
- Click the chip's `×`. Confirm: the full list is restored (previously-hidden non-`+Finance`
  tasks reappear), and the chip disappears.
- Click a `+Finance` pill and a `#calls` pill (on different rows) to combine both filters.
  Confirm only tasks with *both* show (AND semantics) and two chips appear.

- [ ] **Step 6: Commit**

```bash
git add src/view.ts styles.css
git commit -m "feat: click-to-filter project/context pills with removable chip bar"
```

---

## Task 4: `main.ts` — `enableAggregatedViewPills` setting

**Files:**
- Modify: `src/main.ts:13-18` (settings interface + defaults), `src/main.ts:97-117`
  (`loadSettings` validation), `src/main.ts:144-206` (settings tab `display()`)
- Modify: `src/view.ts` (gate `renderTaskRow` on the setting)
- Test: none new (settings validation pattern is already covered implicitly by the existing
  `loadSettings` structure; this task follows that exact pattern for a boolean, same as
  `enableDateSuggest`). Manual verification only.

**Interfaces:**
- Consumes: none new.
- Produces: `TodotxtMdSettings.enableAggregatedViewPills: boolean` (default `true`), read by
  `AggregatedTaskView` via `this.plugin.settings.enableAggregatedViewPills`.

- [ ] **Step 1: Add the setting field, default, and validation in `src/main.ts`**

```typescript
interface TodotxtMdSettings {
	defaultPriority: string;
	enableDateSuggest: boolean;
	scanFolders: string[];
	defaultDueWindow: DueWindow;
	enableAggregatedViewPills: boolean;
}

const DEFAULT_SETTINGS: TodotxtMdSettings = {
	defaultPriority: "A",
	enableDateSuggest: true,
	scanFolders: [],
	defaultDueWindow: "all",
	enableAggregatedViewPills: true,
};
```

In `loadSettings()`, add to the returned object:

```typescript
enableAggregatedViewPills:
	loaded && typeof loaded.enableAggregatedViewPills === "boolean"
		? loaded.enableAggregatedViewPills
		: DEFAULT_SETTINGS.enableAggregatedViewPills,
```

- [ ] **Step 2: Add the settings-tab toggle in `src/main.ts`'s `display()`**

```typescript
new Setting(containerEl)
	.setName("Aggregated view pills")
	.setDesc("Show colored +project/#context pills in the aggregated task view, with click-to-filter.")
	.addToggle((toggle) =>
		toggle.setValue(this.plugin.settings.enableAggregatedViewPills).onChange(async (value) => {
			this.plugin.settings.enableAggregatedViewPills = value;
			await this.plugin.saveSettings();
		}),
	);
```

- [ ] **Step 3: Gate `renderTaskRow` in `src/view.ts` on the setting**

Wrap the pill-rendering portion so disabling the setting falls back to flat text with no click
handlers. Replace the project/context loops in `renderTaskRow` with:

```typescript
if (this.plugin.settings.enableAggregatedViewPills) {
	for (const project of task.projects) {
		container.appendText(" ");
		const pill = container.createSpan({
			text: `+${project}`,
			cls: "todotxt-md-pill todotxt-md-pill-project",
		});
		pill.style.color = nameToColor(project);
		pill.addEventListener("click", (evt) => {
			evt.stopPropagation();
			this.toggleProjectFilter(project);
		});
	}
	for (const context of task.contexts) {
		container.appendText(" ");
		const pill = container.createSpan({
			text: `#${context}`,
			cls: "todotxt-md-pill todotxt-md-pill-context",
		});
		pill.style.color = nameToColor(context);
		pill.addEventListener("click", (evt) => {
			evt.stopPropagation();
			this.toggleContextFilter(context);
		});
	}
} else {
	for (const project of task.projects) {
		container.appendText(` +${project}`);
	}
	for (const context of task.contexts) {
		container.appendText(` #${context}`);
	}
}
```

Also gate the chip bar: in `renderFilterControls`, only call
`this.renderActiveFilterChips(controls)` when `this.plugin.settings.enableAggregatedViewPills`
is `true`.

- [ ] **Step 4: Build and manually verify in Obsidian**

Run: `npm run build`

Open plugin settings, toggle "Aggregated view pills" off. Confirm the aggregated view falls back
to plain `+Finance #calls`-style flat text with no color and no click behavior. Toggle back on
(reopen the view or trigger a rescan by editing a file) and confirm pills return.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/view.ts
git commit -m "feat: add enableAggregatedViewPills setting, default on"
```

---

## Task 5: `parse.ts` — `parseTaskLineWithSpans` and `detectMalformedPriority`

**Files:**
- Modify: `src/parse.ts` (add two new exported functions; `parseTaskLine` itself unchanged)
- Test: `tests/parse.test.ts` (extend existing suite)

**Interfaces:**
- Consumes: `tests/fixtures/tasks.ts`'s existing `fixtures` array (reused for offset
  assertions).
- Produces:
  - `interface TokenSpan { start: number; end: number; kind: "priority" | "creationDate" |
    "completionDate" | "project" | "context" | "due" | "threshold" }`
  - `parseTaskLineWithSpans(line: string): { task: Task; spans: TokenSpan[] } | null`
  - `detectMalformedPriority(line: string): TokenSpan | null` (its `kind` is always
    `"priority"`)

  Later task (Task 6, `highlight.ts`) imports both functions and `TokenSpan` by these exact
  names.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/parse.test.ts — add to the existing file

import { parseTaskLineWithSpans, detectMalformedPriority } from "../src/parse";

describe("parseTaskLineWithSpans", () => {
	it("returns correct offsets for a canonical full line", () => {
		const line = "- [ ] (A) 2026-09-19 Call the bank about the loan +Finance #calls due:2026-09-25";
		const result = parseTaskLineWithSpans(line);
		expect(result).not.toBeNull();
		if (!result) return;

		for (const span of result.spans) {
			const text = line.slice(span.start, span.end);
			if (span.kind === "priority") expect(text).toBe("(A)");
			if (span.kind === "creationDate") expect(text).toBe("2026-09-19");
			if (span.kind === "project") expect(text).toBe("+Finance");
			if (span.kind === "context") expect(text).toBe("#calls");
			if (span.kind === "due") expect(text).toBe("due:2026-09-25");
		}

		const kinds = result.spans.map((s) => s.kind).sort();
		expect(kinds).toEqual(["context", "creationDate", "due", "priority", "project"].sort());
	});

	it("returns offsets for multiple projects/contexts in order", () => {
		const line = "- [ ] +Proj1 +Proj2 Call the bank";
		const result = parseTaskLineWithSpans(line);
		expect(result).not.toBeNull();
		if (!result) return;

		const projectSpans = result.spans.filter((s) => s.kind === "project");
		expect(projectSpans).toHaveLength(2);
		expect(line.slice(projectSpans[0].start, projectSpans[0].end)).toBe("+Proj1");
		expect(line.slice(projectSpans[1].start, projectSpans[1].end)).toBe("+Proj2");
	});

	it("handles the duplicate due: ambiguity the same way parseTaskLine does", () => {
		const line = "- [ ] Call the bank due:2026-09-25 due:2026-09-30";
		const result = parseTaskLineWithSpans(line);
		expect(result).not.toBeNull();
		if (!result) return;

		const dueSpans = result.spans.filter((s) => s.kind === "due");
		expect(dueSpans).toHaveLength(1);
		expect(line.slice(dueSpans[0].start, dueSpans[0].end)).toBe("due:2026-09-25");
	});

	it("returns completionDate span for a completed task", () => {
		const line = "- [x] 2026-09-20 (A) 2026-09-19 Renewed passport +Admin";
		const result = parseTaskLineWithSpans(line);
		expect(result).not.toBeNull();
		if (!result) return;

		const completionSpan = result.spans.find((s) => s.kind === "completionDate");
		expect(completionSpan).toBeDefined();
		if (!completionSpan) return;
		expect(line.slice(completionSpan.start, completionSpan.end)).toBe("2026-09-20");
	});

	it("returns null for a non-checkbox line", () => {
		expect(parseTaskLineWithSpans("Just a regular line")).toBeNull();
	});
});

describe("detectMalformedPriority", () => {
	it("detects wrong bracket characters in the leading position", () => {
		for (const line of ["- [ ] [A] Call the bank", "- [ ] {A} Call the bank", "- [ ] <A> Call the bank"]) {
			const result = detectMalformedPriority(line);
			expect(result).not.toBeNull();
			if (!result) continue;
			expect(result.kind).toBe("priority");
		}
	});

	it("detects invalid content shape in the leading position", () => {
		for (const line of ["- [ ] (AA) Call the bank", "- [ ] (1) Call the bank"]) {
			expect(detectMalformedPriority(line)).not.toBeNull();
		}
	});

	it("returns null for valid priority (uppercase or lowercase)", () => {
		expect(detectMalformedPriority("- [ ] (A) Call the bank")).toBeNull();
		expect(detectMalformedPriority("- [ ] (a) Call the bank")).toBeNull();
	});

	it("returns null for a non-leading bracket-shaped token", () => {
		expect(detectMalformedPriority("- [ ] Buy milk [item]")).toBeNull();
	});

	it("returns null for a non-checkbox line", () => {
		expect(detectMalformedPriority("Just a regular line")).toBeNull();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/parse.test.ts`
Expected: FAIL — `parseTaskLineWithSpans`/`detectMalformedPriority` are not exported from
`../src/parse`.

- [ ] **Step 3: Implement `parseTaskLineWithSpans` by mirroring `parseTaskLine`'s consumption order**

Add to `src/parse.ts`, after `parseTaskLine`:

```typescript
export interface TokenSpan {
	/** 0-indexed offset into the original line string (not the sliced `body`). */
	start: number;
	end: number;
	kind:
		| "priority"
		| "creationDate"
		| "completionDate"
		| "project"
		| "context"
		| "due"
		| "threshold";
}

/**
 * Same parse as parseTaskLine, but also returns each recognized token's [start, end) offset in
 * the original line. Mirrors parseTaskLine's exact consumption order and logic so the two
 * functions never disagree about which token is "the real one" in ambiguous cases (e.g.
 * duplicate due:). Used only by the in-editor decoration layer (src/highlight.ts).
 */
export function parseTaskLineWithSpans(line: string): { task: Task; spans: TokenSpan[] } | null {
	const checkboxMatch = CHECKBOX_RE.exec(line);
	if (!checkboxMatch) return null;

	const [, prefix, mark, , rest] = checkboxMatch;
	const done = mark === "x" || mark === "X";
	const indent = prefix.match(/^\s*/)?.[0] ?? "";

	const spans: TokenSpan[] = [];
	let offset = prefix.length + mark.length + checkboxMatch[3].length;
	let body = rest;

	let completionDate: string | null = null;
	if (done) {
		const completionMatch = LEADING_DATE_RE.exec(body);
		if (completionMatch) {
			completionDate = completionMatch[1];
			spans.push({
				kind: "completionDate",
				start: offset,
				end: offset + completionMatch[1].length,
			});
			body = body.slice(completionMatch[0].length);
			offset += completionMatch[0].length;
		}
	}

	let priority: string | null = null;
	const priorityMatch = PRIORITY_RE.exec(body);
	if (priorityMatch) {
		priority = priorityMatch[1].toUpperCase();
		spans.push({ kind: "priority", start: offset, end: offset + priorityMatch[1].length + 2 });
		body = body.slice(priorityMatch[0].length);
		offset += priorityMatch[0].length;
	}

	let creationDate: string | null = null;
	const creationMatch = LEADING_DATE_RE.exec(body);
	if (creationMatch) {
		creationDate = creationMatch[1];
		spans.push({ kind: "creationDate", start: offset, end: offset + creationMatch[1].length });
		body = body.slice(creationMatch[0].length);
		offset += creationMatch[0].length;
	}

	const projects: string[] = [];
	const contexts: string[] = [];
	let due: string | null = null;
	let threshold: string | null = null;

	const words = body.split(" ");
	const remainder: string[] = [];

	for (const word of words) {
		const wordStart = offset;
		offset += word.length + 1; // +1 for the space split() consumed

		if (word.startsWith("+") && word.length > 1) {
			projects.push(word.slice(1));
			spans.push({ kind: "project", start: wordStart, end: wordStart + word.length });
			continue;
		}
		if (word.startsWith("#") && word.length > 1) {
			contexts.push(word.slice(1));
			spans.push({ kind: "context", start: wordStart, end: wordStart + word.length });
			continue;
		}
		if (word.startsWith("due:")) {
			const value = word.slice(4);
			if (ISO_DATE_RE.test(value) && due === null) {
				due = value;
				spans.push({ kind: "due", start: wordStart, end: wordStart + word.length });
				continue;
			}
		}
		if (word.startsWith("t:")) {
			const value = word.slice(2);
			if (ISO_DATE_RE.test(value) && threshold === null) {
				threshold = value;
				spans.push({ kind: "threshold", start: wordStart, end: wordStart + word.length });
				continue;
			}
		}
		remainder.push(word);
	}

	const description = remainder.join(" ").trim();

	const task: Task = {
		indent,
		done,
		completionDate,
		priority,
		creationDate,
		description,
		projects,
		contexts,
		due,
		threshold,
	};

	return { task, spans };
}
```

- [ ] **Step 4: Implement `detectMalformedPriority`**

Add to `src/parse.ts`, after `parseTaskLineWithSpans`:

```typescript
const MALFORMED_PRIORITY_RE = /^(\[|\{|<)([A-Za-z0-9]{1,2})(\]|\}|>)\s*/;

/**
 * Detects a priority-shaped-but-invalid token in the leading position (immediately after the
 * checkbox) — wrong bracket character, or parenthesized content that isn't exactly one A-Z/a-z
 * letter. Independent of parseTaskLineWithSpans: a not-recognized leading token is exactly what
 * parseTaskLine already leaves untouched in `description`, so this is a separate "does this
 * look like an attempted priority" heuristic, not a grammar rule. Only scans the leading
 * position (mirrors PRIORITY_RE's own position restriction) — never mid-description. Returns
 * null if there's no checkbox, or nothing priority-shaped is present. Does NOT flag a token
 * already recognized by PRIORITY_RE (valid "(A)" or lowercase "(a)") — those are a separate
 * "will be normalized" case the decoration layer derives directly from
 * parseTaskLineWithSpans's priority span.
 */
export function detectMalformedPriority(line: string): TokenSpan | null {
	const checkboxMatch = CHECKBOX_RE.exec(line);
	if (!checkboxMatch) return null;

	const [, prefix, , , rest] = checkboxMatch;
	const offset = prefix.length + checkboxMatch[2].length + checkboxMatch[3].length;

	if (PRIORITY_RE.test(rest)) return null;

	const malformedMatch = MALFORMED_PRIORITY_RE.exec(rest);
	if (!malformedMatch) return null;

	return {
		kind: "priority",
		start: offset,
		end: offset + malformedMatch[0].trimEnd().length,
	};
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/parse.test.ts`
Expected: PASS (all existing tests plus the new ones in this task).

- [ ] **Step 6: Run the full test suite to confirm no regression**

Run: `npx vitest run`
Expected: PASS (all suites, including `tests/aggregate.test.ts`, `tests/editor.test.ts`, etc.,
unaffected by this task).

- [ ] **Step 7: Commit**

```bash
git add src/parse.ts tests/parse.test.ts
git commit -m "feat: add parseTaskLineWithSpans and detectMalformedPriority for in-editor highlighting"
```

---

## Task 6: `src/highlight.ts` — CM6 decoration extension

**Files:**
- Create: `src/highlight.ts`
- Test: manual only, per the design spec's testing posture (CM6 registration/rendering is
  "manually verified only," consistent with `view.ts`/`dateSuggest.ts`).

**Interfaces:**
- Consumes: `parseTaskLineWithSpans`, `detectMalformedPriority`, `TokenSpan` (Task 5);
  `nameToColor` (Task 1).
- Produces: `buildHighlightExtension(isEnabled: () => boolean): Extension` — registered in
  Task 7's `main.ts` change via `this.registerEditorExtension(...)`.

- [ ] **Step 1: Write the implementation**

```typescript
// src/highlight.ts
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";
import { parseTaskLineWithSpans, detectMalformedPriority, type TokenSpan } from "./parse";
import { nameToColor } from "./tokenColors";

const KIND_TO_CLASS: Partial<Record<TokenSpan["kind"], string>> = {
	creationDate: "todotxt-md-hl-date",
	due: "todotxt-md-hl-date",
	threshold: "todotxt-md-hl-date",
};

/**
 * Builds the CM6 decoration set for currently-visible lines only (DESIGN_RULES.md section 3.4
 * "operate on the minimal scope") — never the whole document, so cost stays proportional to
 * what's on screen rather than document size.
 */
function buildDecorations(view: EditorView, isEnabled: () => boolean): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	if (!isEnabled()) return builder.finish();

	for (const { from, to } of view.visibleRanges) {
		let pos = from;
		while (pos <= to) {
			const line = view.state.doc.lineAt(pos);
			const lineText = line.text;

			const parsed = parseTaskLineWithSpans(lineText);
			if (parsed) {
				if (parsed.task.done) {
					builder.add(
						line.from,
						line.from,
						Decoration.line({ class: "todotxt-md-hl-done-line" }),
					);
				}
				for (const span of parsed.spans) {
					if (span.kind === "priority") continue; // never colored when valid

					const absFrom = line.from + span.start;
					const absTo = line.from + span.end;
					const className =
						span.kind === "project" || span.kind === "context"
							? null // handled below via inline color, not a shared class
							: KIND_TO_CLASS[span.kind];

					if (span.kind === "project" || span.kind === "context") {
						const name = lineText.slice(span.start, span.end).slice(1); // strip +/#
						builder.add(
							absFrom,
							absTo,
							Decoration.mark({
								attributes: { style: `color: ${nameToColor(name)}` },
							}),
						);
					} else if (className) {
						builder.add(absFrom, absTo, Decoration.mark({ class: className }));
					}
				}

				const prioritySpan = parsed.spans.find((s) => s.kind === "priority");
				if (prioritySpan) {
					const text = lineText.slice(prioritySpan.start, prioritySpan.end);
					if (/[a-z]/.test(text)) {
						builder.add(
							line.from + prioritySpan.start,
							line.from + prioritySpan.end,
							Decoration.mark({ class: "todotxt-md-hl-priority-lowercase" }),
						);
					}
				}
			}

			const malformed = detectMalformedPriority(lineText);
			if (malformed) {
				builder.add(
					line.from + malformed.start,
					line.from + malformed.end,
					Decoration.mark({ class: "todotxt-md-hl-priority-malformed" }),
				);
			}

			pos = line.to + 1;
		}
	}

	return builder.finish();
}

/**
 * CM6 extension coloring task-line tokens in Live Preview/Source mode. Decorations stay
 * visible while the cursor is inside them (unlike markup-concealment behavior) since they
 * color semantic categories, not syntax markup — concealing them while editing would remove
 * the scanning benefit the feature exists for. Inert in Reading mode, which doesn't use CM6.
 */
export function buildHighlightExtension(isEnabled: () => boolean): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildDecorations(view, isEnabled);
			}

			update(update: ViewUpdate): void {
				if (update.docChanged || update.viewportChanged || update.selectionSet) {
					this.decorations = buildDecorations(update.view, isEnabled);
				}
			}
		},
		{
			decorations: (plugin) => plugin.decorations,
		},
	);
}
```

> Note for the implementer: confirm the exact import paths (`@codemirror/language`,
> `@codemirror/state`, `@codemirror/view`) resolve against this project's installed `obsidian`
> package version — Obsidian re-exports its bundled CM6 packages, and `dateSuggest.ts`'s
> existing `EditorSuggest` usage imports only from `"obsidian"` directly. If `@codemirror/*`
> subpackages are not separately resolvable in this project's `node_modules`, import the same
> symbols from `"obsidian"` instead (check `node_modules/obsidian/obsidian.d.ts` for
> re-exported CM6 symbols) and adjust the `import` lines accordingly — this is a mechanical
> resolution detail, not a design change.

- [ ] **Step 2: Add CSS for the new decoration classes to `styles.css`**

```css
.todotxt-md-hl-date {
	color: var(--todotxt-md-hl-date-color, var(--text-accent));
}

.todotxt-md-hl-done-line {
	color: var(--todotxt-md-hl-done-line-color, var(--text-muted));
}

.todotxt-md-hl-priority-malformed {
	text-decoration: underline wavy var(--todotxt-md-hl-priority-malformed-color, #e45756);
}

.todotxt-md-hl-priority-lowercase {
	color: var(--todotxt-md-hl-priority-lowercase-color, var(--text-faint));
}
```

Add the corresponding entries to the existing `/* @settings */` block at the top of
`styles.css`:

```yaml
  - id: todotxt-md-hl-date-color
    title: In-editor Date Color
    description: Color for creation/due/threshold dates highlighted inside notes
    type: variable-color
    format: hex
    default: '#4285F4'

  - id: todotxt-md-hl-done-line-color
    title: In-editor Done Task Color
    description: Color for completed task lines highlighted inside notes
    type: variable-color
    format: hex
    default: '#808080'

  - id: todotxt-md-hl-priority-malformed-color
    title: Malformed Priority Underline Color
    description: Underline color for a priority-shaped-but-invalid token (e.g. "[A]", "(AA)")
    type: variable-color
    format: hex
    default: '#E45756'

  - id: todotxt-md-hl-priority-lowercase-color
    title: Lowercase Priority Color
    description: Color cue for a valid but lowercase priority (e.g. "(a)") that will be normalized to uppercase
    type: variable-color
    format: hex
    default: '#999999'
```

- [ ] **Step 3: Build and manually verify in Obsidian**

Run: `npm run build`

In the test vault, in a note (Live Preview mode), type several task lines and confirm:
- `- [ ] (A) 2026-10-03 Call the bank +Finance #calls due:2026-10-10` — `+Finance` and `#calls`
  render in their hash-derived colors (matching the aggregated view's pill colors for the same
  names), the creation date and `due:2026-10-10` render in the date color, priority `(A)` stays
  uncolored.
- `- [ ] [A] Call the bank` — `[A]` shows the malformed-priority wavy underline.
- `- [ ] (a) Call the bank` — `(a)` shows the lowercase-priority cue, distinct from the
  malformed treatment.
- `- [ ] Buy milk [item]` — `[item]` is NOT flagged (4 characters, not leading-position
  priority-shaped... confirm it's still not flagged since it's mid-description either way).
- `- [x] 2026-10-01 Renewed passport +Admin` — whole line gets the done-line color; `+Admin`
  is still visibly colored against it (Review Focus item: confirm readable, not two colors
  collapsing to look identical).
- Switch to Reading mode: confirm no decoration artifacts appear (inherent to CM6 not applying
  there — nothing to configure, just confirm no crash/visual glitch).
- Place the cursor inside a `+Finance` token and confirm the color stays visible (not concealed
  like markdown markup).

- [ ] **Step 4: Commit**

```bash
git add src/highlight.ts styles.css
git commit -m "feat: add CM6 in-editor decoration for project/context/date/priority tokens"
```

---

## Task 7: `main.ts` — register the highlight extension with `enableInEditorHighlight` setting

**Files:**
- Modify: `src/main.ts:13-18` (settings interface + defaults), `src/main.ts:97-117`
  (`loadSettings` validation), `src/main.ts:47-95` (`onload`), `src/main.ts:144-206` (settings
  tab `display()`)
- Test: none new — same validated-boolean-setting pattern as Task 4 and the existing
  `enableDateSuggest`; manual verification only.

**Interfaces:**
- Consumes: `buildHighlightExtension` (Task 6).
- Produces: `TodotxtMdSettings.enableInEditorHighlight: boolean` (default `true`).

- [ ] **Step 1: Add the setting field, default, and validation in `src/main.ts`**

```typescript
interface TodotxtMdSettings {
	defaultPriority: string;
	enableDateSuggest: boolean;
	scanFolders: string[];
	defaultDueWindow: DueWindow;
	enableAggregatedViewPills: boolean;
	enableInEditorHighlight: boolean;
}

const DEFAULT_SETTINGS: TodotxtMdSettings = {
	defaultPriority: "A",
	enableDateSuggest: true,
	scanFolders: [],
	defaultDueWindow: "all",
	enableAggregatedViewPills: true,
	enableInEditorHighlight: true,
};
```

In `loadSettings()`, add:

```typescript
enableInEditorHighlight:
	loaded && typeof loaded.enableInEditorHighlight === "boolean"
		? loaded.enableInEditorHighlight
		: DEFAULT_SETTINGS.enableInEditorHighlight,
```

- [ ] **Step 2: Register the extension in `onload()`**

Add the import and registration call in `src/main.ts`:

```typescript
import { buildHighlightExtension } from "./highlight";

// inside onload(), alongside the existing registerEditorSuggest call:
this.registerEditorExtension(
	buildHighlightExtension(() => this.settings.enableInEditorHighlight),
);
```

- [ ] **Step 3: Add the settings-tab toggle**

```typescript
new Setting(containerEl)
	.setName("In-editor highlighting")
	.setDesc("Color +project, #context, and date tokens inline while editing a task line.")
	.addToggle((toggle) =>
		toggle.setValue(this.plugin.settings.enableInEditorHighlight).onChange(async (value) => {
			this.plugin.settings.enableInEditorHighlight = value;
			await this.plugin.saveSettings();
			this.app.workspace.updateOptions();
		}),
	);
```

> Note for the implementer: `buildHighlightExtension`'s `isEnabled` callback is re-read on every
> CM6 `update()` cycle, so toggling the setting takes effect on the next edit/viewport change
> without needing a `Compartment`/full re-registration — confirm this is sufficient during
> manual verification (Step 4); if decorations don't disappear until the user types, that's the
> one open item flagged in the design spec ("whether toggling requires restarting the extension
> via a CM6 Compartment/effect") — escalate back to design only if `updateOptions()` doesn't
> force the needed redraw, rather than silently patching around it.

- [ ] **Step 4: Build and manually verify in Obsidian**

Run: `npm run build`

Toggle "In-editor highlighting" off in settings. Confirm colors disappear from task lines in an
open note (trigger a redraw by switching panes or editing a line if needed). Toggle back on and
confirm colors return.

- [ ] **Step 5: Run the full test suite one final time**

Run: `npx vitest run`
Expected: PASS (all suites).

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "feat: add enableInEditorHighlight setting, register highlight extension"
```

---

## Task 8: Documentation — `SPEC.md` and `DESIGN_RULES.md` updates

**Files:**
- Modify: `SPEC.md` (grammar/architecture sections, v1 commands list)
- Modify: `DESIGN_RULES.md` (if the "UI chrome stays visually minimal" principle in §1.2 needs
  an explicit carve-out noted, per the design specs' own reasoning for why colored pills don't
  violate it)

- [ ] **Step 1: Update `SPEC.md`'s v1 commands / architecture section**

Add a line noting the aggregated view now renders colored, clickable project/context pills, and
that task lines are decorated with color inside the editor (both display-only, grammar
unchanged). Reference both spec files
(`docs/superpowers/specs/2026-10-03-aggregated-view-pills-and-filters-design.md`,
`docs/superpowers/specs/2026-09-21-in-editor-highlighting-design.md`) as the source of the
detailed design.

- [ ] **Step 2: Add a `DESIGN_RULES.md` note under §1.2 if not already implied**

Confirm whether §1.2 ("UI chrome stays visually minimal and text-first") needs an explicit
`> changed:` note. Per both specs' own reasoning, this is display-only color over existing
characters, not new chrome/emoji — if the existing wording already covers this (it does, since
it only restricts *stored text* and emoji, not optional display coloring), no edit is strictly
required. Add a one-line clarifying note only if, on reading §1.2 fresh, it could plausibly be
misread as prohibiting this feature.

- [ ] **Step 3: Commit**

```bash
git add SPEC.md DESIGN_RULES.md
git commit -m "docs: document project/context visual affordances in SPEC and DESIGN_RULES"
```
