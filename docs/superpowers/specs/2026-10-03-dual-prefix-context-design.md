# Dual-prefix context support (`@context` + `#context`) — Design

> Written during a brainstorming session (architectural path). Self-contained: read this file
> plus `SPEC.md`/`DESIGN_RULES.md` to implement, no other conversation context required.

## Why

Manually testing the token-visual-affordances feature (colored pills, click-to-filter) in a real
vault surfaced that `@place`-style tokens have no color/pill/filter treatment at all. Investigating
why led back to a 2026-09-20 decision recorded in `DESIGN_RULES.md` §2.4/`SPEC.md`: this project
deliberately replaced todo.txt's standard `@context` with Obsidian-native `#tag`, as a one-for-one
substitution, specifically to get free tag-pane/search indexing.

The user's point: that substitution throws away real value from the todo.txt spec for users who
want strict spec compatibility (e.g. moving tasks between this plugin and another todo.txt tool),
and there's no need to force an either/or choice. This design makes `@context` and `#context`
**both** valid spellings of the same underlying concept — a context/location tag — so a user can
pick either, per token, and get the one they want: `#tag` for Obsidian tag-pane integration, or
`@context` for todo.txt-spec fidelity. Neither is silently rewritten into the other.

This reverses part of (not all of) the 2026-09-20 decision. `due:` remaining non-Dataview-queryable
and the aggregated view's role as the native query mechanism are unaffected — this design is scoped
to the context-token spelling question only.

## Scope

**In scope:**
1. `parse.ts`'s word-recognition loop (in both `parseTaskLine` and `parseTaskLineWithSpans`)
   recognizes a leading `@` exactly like it already recognizes a leading `#`, for context tokens.
2. `Task.contexts` changes shape from `string[]` to `ContextToken[]`, where:
   ```typescript
   export interface ContextToken {
   	name: string;
   	prefix: "@" | "#";
   }
   ```
   Each recognized context token is pushed as `{ name: word.slice(1), prefix: word[0] as "@" | "#" }`,
   preserving appearance order exactly as `projects`/the old `contexts` already did.
3. `serializeTask` reproduces each context token using its own stored `prefix` — `@home` stays
   `@home`, `#calls` stays `#calls`, on every rewrite (priority bump, sort, done-toggle, etc.).
   **No canonicalization, no default prefix setting** — the plugin never invents a context token
   on its own today (no insert/autocomplete command exists), so there is nothing to default.
4. Matching/filtering (`aggregate.ts`'s `AggregateFilter.contexts`, `view.ts`'s click-to-filter)
   operates on `ContextToken.name` only — prefix-blind. A task with `@home` and a filter entry
   `"home"` matches, regardless of which prefix produced that name. Clicking a `#home` pill and a
   `@home` pill (on different tasks) both toggle the *same* filter entry (`"home"`), so filtering
   by "home" shows tasks spelled either way.
5. Coloring (`nameToColor`) is keyed on `ContextToken.name` only, matching the filtering semantics
   above — `@home` and `#home` render as the identical color. The pill's *displayed text* still
   shows the original prefix character (`@home` vs `#home`), only the color is prefix-blind.
6. `highlight.ts`'s CM6 decoration recognizes leading `@` the same way it recognizes `#` for
   context spans, coloring via the same `nameToColor(name)` call, consistent with point 5.
7. Documentation: `DESIGN_RULES.md` §2.4's "deliberate deviation" wording is corrected (no longer
   a one-for-one substitution — both are now first-class), `SPEC.md`'s grammar table/decisions
   table updated, and a new `DECISIONS.md` entry records this partial reversal of the 2026-09-20
   decision with the trade-off reasoning below.

**Out of scope:**
- A "preferred context prefix" setting or any form of canonicalization default — rejected as
  speculative (YAGNI): no feature today generates a context token programmatically, so there is
  nothing for such a setting to govern yet.
- Any mitigation for `@context` tokens' lack of Obsidian tag-pane indexing (e.g. a warning, a
  settings nudge toward `#`). Accepted as an informed, user-chosen trade-off — see Decisions below.
- Merging `@home`/`#home` into one canonical serialized spelling. Each token's literal text is
  preserved exactly as the user typed it; this design adds a second valid spelling, it does not
  prefer one over the other in storage.
- Any change to `+project` tokens, `due:`/`t:` fields, or the Dataview-interop stance established
  2026-09-20 — scoped strictly to the context-token spelling question.

## Decisions

### Both prefixes are first-class; neither is deprecated or auto-converted

Considered: (a) accept both, preserve each token's original spelling exactly, no canonicalization
— chosen; (b) accept both as input, but canonicalize to one spelling (e.g. `#`) on any rewrite;
(c) keep `#tag` as the only stored form, treat `@context` as a sort of legacy shim with a one-time
conversion prompt. (a) directly serves the stated goal — letting the user decide per-token which
spelling they want — and is the only option that doesn't silently rewrite a user's text, which
`DESIGN_RULES.md` §2.2 ("round-trip fidelity... must not reorder or drop tokens the user wrote")
already treats as a hard rule for every other token kind. (b) and (c) were rejected because both
involve the plugin overriding a deliberate user choice without being asked, which is the opposite
of what this feature is for.

### Prefix-blind matching for color/filter identity

Considered: (a) `name` is the sole identity for coloring and filtering, prefix is purely cosmetic
— chosen; (b) the full `prefix+name` string is the identity, so `@home` and `#home` are unrelated
tags with separate colors and separate filter entries. (a) was chosen because the premise of this
whole change is that `@home` and `#home` are the **same concept**, just spelled differently by
user preference — a user filtering by "home" should see all their home-context tasks regardless
of which spelling they or past-them used on a given line. (b) would let two spellings of the same
real-world context silently fragment into two unrelated filter buckets, which defeats the stated
goal more subtly than outright rejecting dual-prefix support would.

### No mitigation for `@context`'s lost tag-pane integration

The original 2026-09-20 rationale for `#tag` was specifically Obsidian-native tag-pane/search
indexing — a benefit intrinsic to Obsidian's own `#` tag syntax, which `@` does not trigger. A
user who writes `@home` instead of `#home` knowingly forgoes that indexing for that token. This is
accepted as an explicit, informed trade-off rather than something to paper over: `#context` remains
strictly more capable within Obsidian (tag-pane + plugin color/filter), while `@context` offers
strict todo.txt-spec compatibility at the cost of that one Obsidian-native integration. Documenting
this trade-off clearly (in `SPEC.md`'s grammar table) is the only mitigation needed — the user is
choosing a real trade-off, not falling into an accidental trap.

## Architecture

### `src/parse.ts`: `ContextToken` replaces bare strings in `Task.contexts`

```typescript
export interface ContextToken {
	name: string;
	prefix: "@" | "#";
}

export interface Task {
	// ... unchanged fields ...
	projects: string[];
	contexts: ContextToken[]; // was string[]
	// ... unchanged fields ...
}
```

In `parseTaskLine`'s word loop, the existing:
```typescript
if (word.startsWith("#") && word.length > 1) {
	contexts.push(word.slice(1));
	continue;
}
```
becomes:
```typescript
if ((word.startsWith("@") || word.startsWith("#")) && word.length > 1) {
	contexts.push({ name: word.slice(1), prefix: word[0] as "@" | "#" });
	continue;
}
```

`serializeTask`'s existing:
```typescript
for (const context of task.contexts) {
	parts.push(`#${context}`);
}
```
becomes:
```typescript
for (const context of task.contexts) {
	parts.push(`${context.prefix}${context.name}`);
}
```

`parseTaskLineWithSpans` (in `src/highlight.ts`'s supporting code, added by the prior
token-visual-affordances plan) gets the identical widened recognition in its own word loop —
it mirrors `parseTaskLine`'s consumption order and must keep doing so, per `DESIGN_RULES.md` §2.1.
Its `TokenSpan.kind` enum already has a generic `"context"` kind; no new `kind` value is needed
since both prefixes produce the same kind, only the source line's character at that position
differs (already captured correctly by the existing `[start, end)` offset, since the offset
includes the prefix character).

### `src/aggregate.ts`: filtering becomes name-keyed against `ContextToken[]`

```typescript
// was: if (filter.contexts.some((c) => !task.contexts.includes(c))) return false;
if (filter.contexts.some((c) => !task.contexts.some((ctx) => ctx.name === c))) return false;
```

`AggregateFilter.contexts: string[]` is unchanged — it already stores bare names (no prefix), since
that's what the filter-chip bar and pill click-to-filter already pass around. No type change here,
only the matching predicate against the new `ContextToken[]` shape.

### `src/view.ts`: pills display the stored prefix, color/filter stay name-keyed

Pill creation (both the row-rendering loop and the gated flat-text fallback) changes from
iterating bare strings to iterating `ContextToken` objects:

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

`toggleContextFilter` itself is unchanged — it already operates on bare names
(`this.filter.contexts`), which remains `string[]`. The flat-text fallback (when
`enableAggregatedViewPills` is off) similarly renders `${context.prefix}${context.name}` instead
of a hardcoded `#${context}`.

### `src/highlight.ts`: no shape change, only recognition widening (via `parse.ts`)

`highlight.ts` never inspects `Task.contexts`'s element shape directly — it only reads
`TokenSpan.kind === "context"` and slices the raw line text for the decoration's name/color
lookup (`lineText.slice(span.start, span.end).slice(1)`, stripping the single prefix character).
Since this slicing already strips exactly one leading character regardless of what it is, no
change is needed in `highlight.ts` itself — the widened recognition entirely lives in
`parseTaskLineWithSpans` (`parse.ts`), and `highlight.ts` picks up `@`-prefixed context spans
automatically once that recognition widens.

### Test fixtures: `tests/fixtures/tasks.ts` updates to the new shape

Every fixture's `contexts: [...]` field updates from bare strings to `ContextToken` objects, e.g.:
```typescript
// was: contexts: ["calls"],
contexts: [{ name: "calls", prefix: "#" }],
```
A **new fixture** is added specifically for this feature: a line mixing both prefixes, e.g.
`- [ ] Call the bank +Finance @home #calls`, asserting `contexts: [{ name: "home", prefix: "@" },
{ name: "calls", prefix: "#" }]` in that order, confirming both recognition and order-preservation
in one case. A **round-trip test** confirms `serializeTask(parseTaskLine(line))` reproduces `@home`
and `#calls` with their original prefixes intact (not silently normalized).

## Testing

- **Unit-tested** (extending `tests/parse.test.ts` and `tests/fixtures/tasks.ts`): `@`-prefix
  recognition in `parseTaskLine`'s word loop; round-trip fidelity preserving each token's original
  prefix; mixed `@`/`#` lines preserve order; `parseTaskLineWithSpans`'s offsets for `@`-prefixed
  context spans (mirroring the existing `#`-prefix span tests).
- **Unit-tested** (extending `tests/aggregate.test.ts`): a filter entry matches tasks regardless of
  which prefix produced that name — e.g. filtering by `"home"` matches both a task with `@home`
  and a task (if one existed) with `#home`.
- **Manually verified only** (`view.ts`, `highlight.ts`, consistent with the existing testing
  posture for these glue-layer files): pill text shows the correct original prefix character;
  `@home` and `#home` pills render the identical color; clicking either toggles the same filter
  chip; in-editor decoration colors `@`-prefixed contexts identically to `#`-prefixed ones.

## Documentation updates required

- `DESIGN_RULES.md` §2.4: replace "contexts use `#tag` (not `@context`)" with wording reflecting
  that both are now accepted, `#tag` recommended for Obsidian tag-pane integration, `@context`
  available for todo.txt-spec fidelity — framed as a user choice, not a deviation needing
  justification.
- `SPEC.md`'s grammar table and decisions table: update the "Contexts" row to describe dual-prefix
  support and the tag-pane trade-off explicitly.
- `DECISIONS.md`: new entry recording this as a **partial reversal** of the 2026-09-20 decision —
  reversing only the context-token either/or framing, not the `due:`/Dataview/aggregated-view
  parts of that decision, which stand unchanged. State the trigger (manual testing surfaced the
  gap; user feedback that forcing a single spelling discarded real todo.txt-spec value) and the
  trade-off accepted (dual-prefix support costs a small amount of type/parsing complexity in
  exchange for not forcing users to choose between spec fidelity and Obsidian integration).

## Open items for the implementation plan (not design decisions — just call out during planning)

- Exact wording for the `DESIGN_RULES.md`/`SPEC.md`/`DECISIONS.md` prose — a documentation-task
  detail, not a design decision.
- Whether `ContextToken` should be exported from `parse.ts` alongside `Task`/`TokenSpan` (it should
  be, since `view.ts` and test fixtures both need the type) — a straightforward export, not a
  decision point.
