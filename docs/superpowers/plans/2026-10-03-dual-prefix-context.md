# Dual-Prefix Context Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept both `@context` (pure todo.txt spec) and `#context` (Obsidian-native tag
integration) as equally valid context-token spellings, preserving each token's original prefix
exactly on every rewrite, while keeping color/filter identity prefix-blind (same name = same
color = same filter entry, regardless of spelling).

**Architecture:** `Task.contexts` changes shape from `string[]` to a new `ContextToken[]`
(`{ name: string; prefix: "@" | "#" }`), defined and exported from `src/parse.ts` alongside
`Task`. `parseTaskLine` and `parseTaskLineWithSpans` both widen their word-recognition loops to
accept a leading `@` wherever they already accept `#`. `serializeTask` reproduces each token's
stored `prefix` character exactly — no canonicalization. Every consumer of the old
`string[]` shape (`aggregate.ts`'s filter matching, `view.ts`'s pill rendering, and every fixture
in `tests/fixtures/tasks.ts`) is updated to read `.name`/`.prefix` instead of treating entries as
bare strings. `highlight.ts` requires no code change — it reads `TokenSpan` offsets and raw line
text, never `Task.contexts`'s element shape directly, so it picks up `@`-prefixed decoration
automatically once `parseTaskLineWithSpans`'s recognition widens.

**Tech Stack:** TypeScript (strict), Vitest. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-03-dual-prefix-context-design.md`

## Global Constraints

- `parse.ts` remains the single source of truth for the grammar; no other module gains
  prefix-recognition logic of its own (`DESIGN_RULES.md` §2.1).
- Round-trip fidelity is non-negotiable: `serializeTask(parseTaskLine(line))` must reproduce each
  context token with its *original* prefix character, never silently converting `@`→`#` or
  vice versa (`DESIGN_RULES.md` §2.2, and this plan's own Decisions: "neither prefix is
  deprecated or auto-converted").
- Color (`nameToColor`) and filter matching (`aggregate.ts`, `view.ts`'s click-to-filter) are
  **prefix-blind** — keyed on `ContextToken.name` only. `@home` and `#home` must produce the
  identical color and the identical filter-chip entry.
- No new settings, no canonicalization default, no tag-pane mitigation for `@`-style tokens —
  all explicitly out of scope per the spec's Decisions section.
- `ContextToken` is exported from `src/parse.ts` (alongside `Task`/`TokenSpan`) since `view.ts`
  and test fixtures both need the type.

## Review Focus

- **A line with only `@`-prefixed contexts (no `#` at all) must parse identically to one with
  only `#`-prefixed contexts** — i.e. the widened recognition must not accidentally require at
  least one `#` token to be present, or silently prefer one prefix when both could match the same
  position. `parseTaskLine`'s word loop processes each word independently, so this should fall
  out naturally, but it's the core case the whole feature exists for and deserves an explicit test.
- **Mixed-prefix order preservation**: `@home #calls` and `#calls @home` on the same line must
  each preserve their own left-to-right order in `Task.contexts`, matching how `projects`/the old
  `contexts` already preserved multi-token order. An implementation that accidentally groups all
  `@`-tokens before all `#`-tokens (e.g. by processing prefixes in two separate passes instead of
  one unified word loop) would violate this silently.
- **`toggleContextFilter`/`renderActiveFilterChips` in `view.ts` must NOT need any shape change** —
  they already operate on bare `string` names via `AggregateFilter.contexts: string[]`, which is
  untouched by this plan. A reviewer should confirm no accidental scope creep turns
  `AggregateFilter.contexts` into `ContextToken[]` too (it must stay `string[]`, per the spec's
  "filtering remains name-keyed" decision) — that would be over-engineering beyond what was asked.
- **The duplicate-`due:`-style literal-text preservation behavior must still work for malformed
  context tokens** — e.g. a bare `@` or `#` with nothing after it (`word.length > 1` guard) must
  still fall through to `description` as literal text, unchanged from today's behavior for lone
  `#`. This existing guard must survive the widened condition untouched.
- **`highlight.ts`'s existing tests (`tests/highlight.test.ts`) must still pass unmodified** —
  since this plan claims no code change is needed there, the existing test suite is the proof;
  if any of those tests start failing, that disproves the "no change needed" architecture claim
  and signals the widened `parseTaskLineWithSpans` recognition broke something else instead.

---

## Task 1: `src/parse.ts` — `ContextToken` type, widened recognition, round-trip serialization

**Files:**
- Modify: `src/parse.ts` (the `Task.contexts` field type; both word loops in `parseTaskLine` and
  `parseTaskLineWithSpans`; `serializeTask`'s context-emission loop)
- Modify: `tests/fixtures/tasks.ts` (every fixture's `contexts: [...]` field, plus one new
  mixed-prefix fixture)
- Test: `tests/parse.test.ts` (new dual-prefix test cases, extending the existing suite)

**Interfaces:**
- Consumes: nothing new from other files.
- Produces: `export interface ContextToken { name: string; prefix: "@" | "#" }`, exported
  alongside `Task`. `Task.contexts` is now `ContextToken[]` (was `string[]`). Later tasks
  (`aggregate.ts`, `view.ts`) consume this exact shape — `.name` for matching/coloring, `.prefix`
  only when reproducing literal token text.

- [ ] **Step 1: Write the failing tests**

Add to `tests/parse.test.ts` (new `describe` block, alongside the existing ones):

```typescript
describe("dual-prefix context support (@ and #)", () => {
	it("recognizes a leading @ exactly like a leading #", () => {
		const task = parseTaskLine("- [ ] Call the bank @home");
		expect(task).not.toBeNull();
		expect(task?.contexts).toEqual([{ name: "home", prefix: "@" }]);
	});

	it("preserves left-to-right order across mixed @ and # tokens", () => {
		const mixed1 = parseTaskLine("- [ ] Call the bank @home #calls");
		expect(mixed1?.contexts).toEqual([
			{ name: "home", prefix: "@" },
			{ name: "calls", prefix: "#" },
		]);

		const mixed2 = parseTaskLine("- [ ] Call the bank #calls @home");
		expect(mixed2?.contexts).toEqual([
			{ name: "calls", prefix: "#" },
			{ name: "home", prefix: "@" },
		]);
	});

	it("round-trips each token's original prefix exactly, no canonicalization", () => {
		const line = "- [ ] Call the bank @home #calls";
		const task = parseTaskLine(line);
		expect(task).not.toBeNull();
		if (!task) return;
		expect(serializeTask(task)).toBe(line);
	});

	it("a lone @ with nothing after it falls through to literal description text", () => {
		const task = parseTaskLine("- [ ] Call the bank @ now");
		expect(task).not.toBeNull();
		expect(task?.contexts).toEqual([]);
		expect(task?.description).toBe("Call the bank @ now");
	});

	it("parseTaskLineWithSpans recognizes @ context spans with correct offsets", () => {
		const line = "- [ ] Call the bank @home";
		const result = parseTaskLineWithSpans(line);
		expect(result).not.toBeNull();
		if (!result) return;
		const contextSpans = result.spans.filter((s) => s.kind === "context");
		expect(contextSpans).toHaveLength(1);
		expect(line.slice(contextSpans[0].start, contextSpans[0].end)).toBe("@home");
	});
});
```

Also add the new import if not already present at the top of `tests/parse.test.ts`:
```typescript
import { parseTaskLine, serializeTask, parseTaskLineWithSpans } from "../src/parse";
```
(Adjust to match whatever the existing import line already lists — add `parseTaskLineWithSpans`
and `serializeTask` only if not already imported; do not duplicate an existing import.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/parse.test.ts`
Expected: FAIL — the new tests fail because `@home` is not yet recognized (it falls through to
`description` under current behavior) and `task?.contexts` is still typed/shaped as `string[]`
with bare strings, not `{ name, prefix }` objects, so even once `@` is recognized by a naive
change the shape assertions would still fail until Step 3's full change lands.

- [ ] **Step 3: Update `Task.contexts`'s type and both word loops in `src/parse.ts`**

Change the `Task` interface (`src/parse.ts:7-23`):
```typescript
export interface ContextToken {
	name: string;
	prefix: "@" | "#";
}

export interface Task {
	/** Leading whitespace/list-marker indentation, preserved verbatim. */
	indent: string;
	done: boolean;
	/** Completion date, only present when done. ISO YYYY-MM-DD. */
	completionDate: string | null;
	/** Priority letter A-Z, only recognized immediately after the checkbox. */
	priority: string | null;
	/** Bare leading date (todo.txt creation-date convention). ISO YYYY-MM-DD. */
	creationDate: string | null;
	/** Free-text description with recognized tokens removed, extra tokens left inline. */
	description: string;
	projects: string[];
	/** @context and #context are both accepted; each token's original prefix is preserved. */
	contexts: ContextToken[];
	due: string | null;
	threshold: string | null;
}
```

In `parseTaskLine` (`src/parse.ts:70-86`), change:
```typescript
	const projects: string[] = [];
	const contexts: string[] = [];
```
to:
```typescript
	const projects: string[] = [];
	const contexts: ContextToken[] = [];
```

And change:
```typescript
		if (word.startsWith("#") && word.length > 1) {
			contexts.push(word.slice(1));
			continue;
		}
```
to:
```typescript
		if ((word.startsWith("@") || word.startsWith("#")) && word.length > 1) {
			contexts.push({ name: word.slice(1), prefix: word[0] as "@" | "#" });
			continue;
		}
```

In `parseTaskLineWithSpans` (`src/parse.ts:185-205`), make the identical change: `contexts` is
declared as `ContextToken[]`, and the context-recognition branch becomes:
```typescript
		if ((word.startsWith("@") || word.startsWith("#")) && word.length > 1) {
			contexts.push({ name: word.slice(1), prefix: word[0] as "@" | "#" });
			spans.push({ kind: "context", start: wordStart, end: wordStart + word.length });
			continue;
		}
```

- [ ] **Step 4: Update `serializeTask`'s context-emission loop**

Change (`src/parse.ts:302-304`):
```typescript
	for (const context of task.contexts) {
		parts.push(`#${context}`);
	}
```
to:
```typescript
	for (const context of task.contexts) {
		parts.push(`${context.prefix}${context.name}`);
	}
```

- [ ] **Step 5: Update every fixture in `tests/fixtures/tasks.ts` to the new shape**

Change each fixture's `contexts: [...]` field from bare strings to `ContextToken` objects.
Concretely, in `tests/fixtures/tasks.ts`:

- Line 36: `contexts: ["calls"],` → `contexts: [{ name: "calls", prefix: "#" }],`
- Lines 52, 68, 84, 100, 117, 133, 149, 165: `contexts: [],` stay exactly as `contexts: [],`
  (empty arrays need no change — the shape is still correct, just typed differently, which
  TypeScript infers automatically for an empty array literal in this context).

Also add **one new fixture** to the `fixtures` array (append after the last entry, before the
closing `];`), covering the mixed-prefix case end-to-end through the shared fixture mechanism
that both `parse.test.ts` and `sort.test.ts` consume:

```typescript
	{
		name: "mixed @ and # context prefixes preserved in order",
		raw: "- [ ] Call the bank @home #calls",
		parsed: {
			indent: "",
			done: false,
			completionDate: null,
			priority: null,
			creationDate: null,
			description: "Call the bank",
			projects: [],
			contexts: [
				{ name: "home", prefix: "@" },
				{ name: "calls", prefix: "#" },
			],
			due: null,
			threshold: null,
		},
	},
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/parse.test.ts`
Expected: PASS (all existing tests plus the new dual-prefix describe block).

- [ ] **Step 7: Run the full test suite to confirm the fixture change didn't break `sort.test.ts`**

Run: `npx vitest run`
Expected: Likely FAIL at this point — `tests/aggregate.test.ts:74`
(`r.task.contexts.includes("calls")`) and `tests/sort.test.ts` (if it reads `.contexts` at all)
may still assume the old bare-string shape. This is expected and is NOT this task's job to fix —
`aggregate.ts`'s consumer code and its test are Task 2's responsibility. Confirm specifically
that failures are isolated to `tests/aggregate.test.ts` (and not, for example, new failures in
`tests/parse.test.ts` or `tests/highlight.test.ts`, which would indicate this task's own change
is incomplete or wrong). Report the exact failing test names in your report.

- [ ] **Step 8: Commit**

```bash
git add src/parse.ts tests/fixtures/tasks.ts tests/parse.test.ts
git commit -m "feat: accept @context alongside #context, preserve prefix on round-trip"
```

---

## Task 2: `src/aggregate.ts` + `src/view.ts` — prefix-blind matching and pill display

**Files:**
- Modify: `src/aggregate.ts:79` (the context-filter matching predicate)
- Modify: `src/view.ts:154-165` (both the pill-rendering branch and the flat-text fallback
  branch's context loops, inside `renderTaskRow`)
- Modify: `tests/aggregate.test.ts:74` (the one assertion that reads `.contexts` as bare strings)

**Interfaces:**
- Consumes: `ContextToken` (Task 1, from `src/parse.ts`).
- Produces: no new exported interfaces. `AggregateFilter.contexts: string[]` is **unchanged** —
  this task only changes how `task.contexts` (now `ContextToken[]`) is matched against it.

- [ ] **Step 1: Write/update the failing test**

In `tests/aggregate.test.ts`, the existing test at line 70-75 currently reads:
```typescript
	it("filters by context with AND semantics", () => {
		const filter: AggregateFilter = { ...DEFAULT_FILTER, contexts: ["calls"] };
		const result = aggregateTasks(records, filter, fixedClock);
		expect(result).toHaveLength(2);
		expect(result.every((r) => r.task.contexts.includes("calls"))).toBe(true);
	});
```

Change the last line to account for the new `ContextToken[]` shape:
```typescript
	it("filters by context with AND semantics", () => {
		const filter: AggregateFilter = { ...DEFAULT_FILTER, contexts: ["calls"] };
		const result = aggregateTasks(records, filter, fixedClock);
		expect(result).toHaveLength(2);
		expect(result.every((r) => r.task.contexts.some((ctx) => ctx.name === "calls"))).toBe(true);
	});
```

Also add a **new test** immediately after it, in the same `describe("aggregateTasks", ...)` block,
proving prefix-blind matching end-to-end:
```typescript
	it("filters by context regardless of whether the task used @ or # for that name", () => {
		const atPrefixRecord = record("- [ ] Pick up dry cleaning @home", "Daily.md", 1);
		const hashPrefixRecord = record("- [ ] Water the plants #home", "Daily.md", 2);
		const filter: AggregateFilter = { ...DEFAULT_FILTER, contexts: ["home"] };
		const result = aggregateTasks([atPrefixRecord, hashPrefixRecord], filter, fixedClock);
		expect(result).toHaveLength(2);
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/aggregate.test.ts`
Expected: FAIL — `r.task.contexts.some` is not yet valid against the shape `aggregate.ts` expects
to filter correctly (the underlying `aggregateTasks` matching predicate in `src/aggregate.ts:79`
still calls `task.contexts.includes(c)`, which is wrong against an array of objects — `.includes`
does identity comparison, so it will never match a `ContextToken` object against a bare string
`c`). Confirm the failure is specifically in the "filters by context" tests, not elsewhere.

- [ ] **Step 3: Update the matching predicate in `src/aggregate.ts`**

Change (`src/aggregate.ts:79`):
```typescript
		if (filter.contexts.some((c) => !task.contexts.includes(c))) return false;
```
to:
```typescript
		if (filter.contexts.some((c) => !task.contexts.some((ctx) => ctx.name === c))) return false;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/aggregate.test.ts`
Expected: PASS (all existing tests plus the new prefix-blind-matching test).

- [ ] **Step 5: Update `src/view.ts`'s pill rendering and flat-text fallback**

In `renderTaskRow` (`src/view.ts:154-172`), the pill-rendering branch currently reads:
```typescript
			for (const context of task.contexts) {
				container.appendText(" ");
				const pill = container.createSpan({
					text: `#${context}`,
					cls: "todotxt-md-pill todotxt-md-pill-context",
				});
				pill.style.backgroundColor = nameToColor(context);
				pill.addEventListener("click", (evt) => {
					evt.stopPropagation();
					this.toggleContextFilter(context);
				});
			}
```
Change to:
```typescript
			for (const context of task.contexts) {
				container.appendText(" ");
				const pill = container.createSpan({
					text: `${context.prefix}${context.name}`,
					cls: "todotxt-md-pill todotxt-md-pill-context",
				});
				pill.style.backgroundColor = nameToColor(context.name);
				pill.addEventListener("click", (evt) => {
					evt.stopPropagation();
					this.toggleContextFilter(context.name);
				});
			}
```

And the flat-text fallback branch (when `enableAggregatedViewPills` is off) currently reads:
```typescript
			for (const context of task.contexts) {
				container.appendText(` #${context}`);
			}
```
Change to:
```typescript
			for (const context of task.contexts) {
				container.appendText(` ${context.prefix}${context.name}`);
			}
```

**Do not change** `renderActiveFilterChips` (`src/view.ts:218-233`) or `toggleContextFilter`
(`src/view.ts:245-253`) — both already operate on bare `string` names via
`this.filter.contexts: string[]`, which this task does not touch. Confirm this by re-reading
those two methods after your edit: they should have zero diff.

- [ ] **Step 6: Build and manually verify no TypeScript errors**

Run: `npm run build`
Expected: clean (no `tsc` errors). This confirms every remaining `task.contexts` access in
`view.ts` correctly treats entries as `ContextToken` objects, not bare strings.

- [ ] **Step 7: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, all suites — this should be the point where the full suite returns to green,
including `tests/highlight.test.ts` (unmodified, per the Review Focus item — if it fails here,
stop and investigate rather than silently patching `highlight.ts`, since the architecture claims
no change is needed there).

- [ ] **Step 8: Commit**

```bash
git add src/aggregate.ts src/view.ts tests/aggregate.test.ts
git commit -m "feat: prefix-blind context matching and dual-prefix pill display"
```

---

## Task 3: Documentation — `DESIGN_RULES.md`, `SPEC.md`, `DECISIONS.md` updates

**Files:**
- Modify: `DESIGN_RULES.md` §2.4 (the "deliberate deviation" wording)
- Modify: `SPEC.md` (grammar table's "Contexts" row, and the decisions table)
- Modify: `DECISIONS.md` (new entry)

- [ ] **Step 1: Update `DESIGN_RULES.md` §2.4**

Find the existing bullet (currently reads, per the file read earlier in this session):
```
4. **Deliberate deviations from pure todo.txt are documented, not accidental.** Current
   deviations: contexts use `#tag` (not `@context`). Any new deviation must be recorded in
   `SPEC.md`'s decisions table with a one-line rationale.
```

Replace with wording reflecting that both prefixes are now accepted — not a deviation requiring
justification, but a deliberate superset:
```
4. **Deliberate deviations from pure todo.txt are documented, not accidental.** Current
   deviations: none for contexts as of 2026-10-03 — both `@context` (pure todo.txt spec) and
   `#tag` (Obsidian-native tag-pane integration) are accepted, each token's original prefix is
   preserved exactly on every rewrite, and neither is silently converted to the other. See
   `DECISIONS.md` (2026-10-03 entry) for the trade-off reasoning. Any *new* deviation must still
   be recorded in `SPEC.md`'s decisions table with a one-line rationale.
```

- [ ] **Step 2: Update `SPEC.md`'s grammar table**

Find the existing "Contexts" row (currently reads, per the file read earlier in this session):
```
| Contexts | `#tag` | **deliberate deviation** from todo.txt `@context` — uses Obsidian-native tags |
```

Replace with:
```
| Contexts | `@context` or `#tag`, both accepted | **both are first-class** (changed 2026-10-03 — see `DECISIONS.md`): `#tag` gets Obsidian-native tag-pane/search indexing; `@context` is pure todo.txt-spec compatible. Each token's original prefix is preserved exactly on every rewrite — neither is canonicalized to the other. |
```

- [ ] **Step 3: Add a new `DECISIONS.md` entry**

Add as the newest entry (top of the file, immediately after the header block, before the
2026-09-21 entry), following the existing entries' format:

```markdown
## 2026-10-03 — Partial reversal: accept `@context` alongside `#tag`, prefix preserved per-token

### Context

The 2026-09-20 decision (see entry below) replaced todo.txt's standard `@context` with
Obsidian-native `#tag` as a one-for-one substitution, specifically for free tag-pane/search
indexing. Manually testing the token-visual-affordances feature (colored pills, click-to-filter)
in a real vault surfaced that this substitution left `@place`-style tokens with no color/pill/
filter support at all, and the user flagged that forcing a single spelling discards real value
from the todo.txt spec — specifically, compatibility with other todo.txt tools when moving tasks
between them.

### Decision

**Both `@context` and `#context` are now accepted as first-class, equally valid spellings of the
same underlying concept.** `Task.contexts` changes from `string[]` to `ContextToken[]`
(`{ name: string; prefix: "@" | "#" }`), so each token's original prefix is preserved exactly on
every rewrite — no canonicalization, no settings-driven default. Color and filter identity
(`nameToColor`, click-to-filter, the aggregated view's filter-chip bar) are keyed on the bare
`name` only, prefix-blind: `@home` and `#home` render the identical color and populate the same
filter entry, since they represent the same real-world context under two different spellings.

### Why this doesn't reverse the whole 2026-09-20 decision

This is a **partial** reversal, scoped strictly to the context-token spelling question. The
`due:`/Dataview-interop stance, the aggregated view's role as the native due-date query mechanism,
and the emoji-rejection principle from that decision all stand unchanged — see the 2026-09-20
entry below for that reasoning, which this entry does not revisit.

### Costs / trade-offs accepted

- A user who writes `@home` instead of `#home` knowingly forgoes Obsidian's native tag-pane/search
  indexing for that specific token — `#` is Obsidian's real tag syntax, `@` is not, and no
  amount of plugin-side color/filter support substitutes for that platform-level integration.
  This is treated as an accepted, informed trade-off (the user's explicit choice), not something
  the plugin tries to mitigate via a warning or nudge.
- `Task.contexts`'s type changed from `string[]` to `ContextToken[]`, a breaking change to the
  parser's own output shape — every consumer (`aggregate.ts`'s filter matching, `view.ts`'s pill
  rendering, every fixture in `tests/fixtures/tasks.ts`) needed updating in lockstep. No consumer
  outside this project's own codebase is known to depend on the old shape (no public API surface
  beyond this plugin's own `main.js` bundle), so this was judged an acceptable one-time cost.

### Reversibility

If this proves to add more parsing/type complexity than value in practice (e.g. users
overwhelmingly prefer one spelling and never use the other), the simplest rollback is **not**
re-removing `@` recognition — that would silently break any task already using `@context`, which
DESIGN_RULES.md explicitly treats as the thing to avoid. Instead, a future decision could add a
one-time, explicitly user-invoked "canonicalize all contexts to `#`" command, leaving the dual
parse-time recognition in place permanently (parsing leniency costs nothing; serialization
defaults can still change).
```

- [ ] **Step 4: Commit**

```bash
git add DESIGN_RULES.md SPEC.md DECISIONS.md
git commit -m "docs: document dual-prefix @/# context support in SPEC, DESIGN_RULES, DECISIONS"
```
