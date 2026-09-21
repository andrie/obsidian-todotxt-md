# In-editor syntax highlighting — Design

> Written during a brainstorming session (architectural path). Self-contained: read this file
> plus `SPEC.md`/`DESIGN_RULES.md` to implement, no other conversation context required.

## Why

`todotxt-md` has no in-editor decoration of task syntax at all today. The only colorable
surfaces are the aggregated view's rendered rows and the date-suggestion popup (added
2026-09-21 alongside a Style Settings `@settings` block) — neither touches text inside a note.
While evaluating optional Style Settings integration (comparing against
`rioskit/obsidian-todo-txt-mode`, which highlights raw todo.txt text live as you type), this gap
was identified as worth closing: the user wants faster visual scanning of busy notes and
in-line surfacing of malformed tokens, with no interop/backward-compatibility constraint versus
other plugins' decoration schemes.

This does **not** conflict with `DESIGN_RULES.md` §1.1 ("plain text is the product") or §1.2
("no emojis... UI chrome stays visually minimal and text-first too"): decoration is a pure CM6
*rendering* layer over the raw text. It never changes a stored character. The file is
byte-identical, and fully legible/portable, whether or not the plugin is running or this feature
is enabled — satisfying §1.1's "must degrade to readable text when it isn't running" exactly as
written. No emojis are introduced; only color (via CSS classes) is applied to real characters
that were already there.

## Scope

**Highlighted when valid (color only, no text change):**
- `+Project` tokens
- `#context` tokens
- Dates: creation date (bare leading date), `due:YYYY-MM-DD`, `t:YYYY-MM-DD`
- Whole-line styling for completed (`- [x]`) tasks

**Explicitly not colored when valid:** priority `(A)`–`(Z)`. The bump-priority hotkeys already
make priority a solved ergonomic problem; no color cue is needed for the valid case.

**New: malformed-priority detection**, distinct from valid-priority coloring above. Flags a
priority-*shaped* token in the leading position (immediately after the checkbox, matching the
grammar's own position rule for real priority) that is not valid per the grammar:
- Wrong bracket character: `[A]`, `{A}`, `<A>`
- Invalid content: `(AA)`, `(1)` — anything that isn't exactly one `A`–`Z` letter between the
  brackets

Detection is restricted to **1–2 character, letter/digit-like content** inside the
bracket/brace/angle-bracket pair, in the leading position only. This keeps false positives at
effectively zero: `- [ ] Buy milk [item]` is never flagged (`item` is 4 characters), and nothing
mid-description is ever scanned (only the leading position is checked, mirroring
`PRIORITY_RE`'s own position-only rule in `parse.ts`).

**Two distinct signal types, two distinct visual treatments** — these must not share a color:
1. **Unrecognized priority-shaped text** (wrong brackets, wrong content length/shape) — a clear
   "this is not being parsed as priority" indicator (e.g. a warning-toned underline/color).
2. **Recognized-but-will-be-normalized** — lowercase `(a)` is already accepted by
   `PRIORITY_RE` and silently uppercased to `"A"` by `parseTaskLine` on any rewrite. This is not
   an error; it gets a lighter, distinct "will be normalized" cue so it's never confused with
   case 1.

**Out of scope for this feature:** Reading mode. Reading mode renders notes as static HTML via
Obsidian's Markdown renderer, not CM6 — a CM6 `ViewPlugin`/decoration extension simply does not
apply there. No exclusion code is needed; it's inherent to the mechanism.

## Architecture

### Decision: extend `parse.ts`, not a separate offset-scanner (refined "Approach B")

Two approaches were considered:

- **(A) Decoration layer re-derives offsets independently** — the CM6 extension calls the
  existing `parseTaskLine` for field *values*, then separately re-scans the raw line with its
  own regexes to find each field's character position. Rejected: `parseTaskLine` consumes the
  line by repeatedly slicing `body` as it recognizes tokens in order — the *order* of
  consumption is exactly what resolves ambiguous cases (e.g. the parse-leniency table's
  documented duplicate-`due:` case, where the first `due:`-shaped token is authoritative and a
  second is left as literal text). A decoration layer re-scanning independently risks disagreeing
  with `parseTaskLine` about which token is "the real one," since it has no access to that
  consumption-order information — it would have to reimplement it, duplicating grammar logic
  outside `parse.ts` in violation of `DESIGN_RULES.md` §2.1 ("`src/parse.ts` is the only place
  that parses/emits task syntax").
- **(B, refined) Add a new function to `parse.ts` that captures offsets during the same parse
  pass** — chosen. `parseTaskLine`'s existing slicing loop already implicitly knows each
  consumed token's position at the moment it slices it off; this approach persists that
  information instead of discarding it.

**`parseTaskLine` itself is unchanged** — same signature, same behavior, zero risk to existing
callers/tests. A new function is added alongside it:

```typescript
// src/parse.ts

export interface TokenSpan {
	/** 0-indexed offset into the original line string (not the sliced `body`). */
	start: number;
	end: number;
	kind: "priority" | "creationDate" | "completionDate" | "project" | "context" | "due" | "threshold";
}

/**
 * Same parse as parseTaskLine, but also returns each recognized token's [start, end) offset
 * in the original line. Used only by the in-editor decoration layer (src/highlight.ts) — no
 * other consumer needs positions, so this stays a separate function rather than changing
 * parseTaskLine's return shape for every caller.
 */
export function parseTaskLineWithSpans(line: string): { task: Task; spans: TokenSpan[] } | null {
	// Mirrors parseTaskLine's exact consumption order; each step additionally records
	// { start: <original-line offset before this slice>, end: <offset after>, kind } into
	// `spans` before advancing `body`. No change to how any token is recognized or ordered —
	// purely additive bookkeeping alongside the existing logic.
}

/**
 * Detects a priority-shaped-but-invalid token in the leading position (immediately after the
 * checkbox) — wrong bracket character, or content that isn't exactly one A-Z/a-z letter.
 * Independent of parseTaskLineWithSpans: a not-recognized leading token is exactly what
 * parseTaskLine already leaves untouched in `description`, so this is a separate "does this
 * look like an attempted priority" heuristic, not a grammar rule. Only scans the leading
 * position (mirrors PRIORITY_RE's own position restriction) — never mid-description.
 * Returns null if there's no checkbox, or nothing priority-shaped is present.
 */
export function detectMalformedPriority(line: string): TokenSpan | null {
	// Checks for [X]/{X}/<X> or (XX)/(1)-shaped content (1-2 chars) immediately after the
	// checkbox marker. Does NOT flag a token already recognized by PRIORITY_RE (e.g. valid
	// "(A)" or lowercase "(a)" -- those are handled by the "will be normalized" cue below,
	// computed separately in the decoration layer by checking if parseTaskLineWithSpans's
	// priority span's original text was lowercase).
}
```

The "will be normalized" (lowercase priority) cue does **not** need a new `parse.ts` function:
the decoration layer can derive it directly from `parseTaskLineWithSpans`'s existing `priority`
span — if the substring at that span's offsets (read from the original line) is lowercase, show
the softer cue instead of the normal (uncolored, per Scope above) priority treatment. This is
glue-layer logic (a string comparison on an already-known span), not new grammar knowledge, so
it belongs in `src/highlight.ts`, not `parse.ts`.

### New file: `src/highlight.ts` (Obsidian/CM6 glue — manually verified, not unit-tested)

Follows the same glue-layer pattern as `dateSuggest.ts`. Exports a CM6 extension (a
`ViewPlugin` building a `DecorationSet`) that:

1. On each view update, iterates only the **visible line range** CM6 reports (never the whole
   document) — matches `DESIGN_RULES.md` §3.4 ("operate on the minimal scope") and avoids
   recomputing decorations for offscreen content on every keystroke.
2. For each visible line, calls `parseTaskLineWithSpans(lineText)`. If it returns non-null,
   builds one `Decoration.mark` per span in `spans` (excluding `priority`, which is never
   colored when valid per Scope), each with a CSS class named `todotxt-md-hl-<kind>` (e.g.
   `todotxt-md-hl-project`, `todotxt-md-hl-due`). If `task.done`, additionally applies a
   whole-line decoration class `todotxt-md-hl-done-line`.
3. Also calls `detectMalformedPriority(lineText)` per visible line (independent of whether
   `parseTaskLineWithSpans` returned non-null, since a malformed leading token means the line
   IS still a checkbox — the checkbox gate is checked inside `detectMalformedPriority` itself).
   If it returns a span, applies class `todotxt-md-hl-priority-malformed`.
4. If `parseTaskLineWithSpans`'s `priority` span exists and its original-line substring is
   lowercase, applies class `todotxt-md-hl-priority-lowercase` instead of leaving it uncolored.
5. **Decorations stay visible while the cursor is inside them** — unlike Obsidian's Live Preview
   concealment of raw Markdown markup (e.g. `**bold**` markers hiding until clicked into), these
   decorations color semantic categories (project/context/date), not syntax markup characters.
   Hiding them while editing would remove exactly the scanning benefit the feature exists for.
   Concretely: do not gate decoration building on cursor/selection position at all.

### Registration in `main.ts`

```typescript
this.highlightExtension = buildHighlightExtension(() => this.settings.enableInEditorHighlight);
this.registerEditorExtension(this.highlightExtension);
```

Mirrors the existing `registerEditorSuggest(this.dateSuggest)` lifecycle pattern. A new setting
`enableInEditorHighlight: boolean` (default `true` — on by default, matching the plugin's core
"assisted formatting" value proposition) gates whether decorations are built at all; toggling it
triggers a CM6 re-render (same mechanism `dateSuggest.ts`'s `setEnabled` uses, if applicable, or
via a CM6 effect/reconfiguration if the extension needs to fully disable rather than just
no-op).

### Styling: extend the existing Style Settings mechanism, don't invent a new one

`styles.css` already has a working `/* @settings */` block (added 2026-09-21, confirmed
functioning) for two aggregated-view colors. This feature adds new entries to the *same* block
for each highlight kind (`todotxt-md-hl-project-color`, `todotxt-md-hl-context-color`,
`todotxt-md-hl-date-color` — one shared color for creation/due/threshold dates, not three
separate ones, to avoid an overwhelming settings list — `todotxt-md-hl-done-line-color`,
`todotxt-md-hl-priority-malformed-color`, `todotxt-md-hl-priority-lowercase-color`), each
consumed via `var(--<id>, <fallback>)` exactly like the existing two. The plugin-level
`enableInEditorHighlight` toggle controls whether decorations exist in the DOM at all; Style
Settings (optional, best-effort per `DESIGN_RULES.md` §3.5) only ever recolors classes that are
already present — consistent with how the two existing settings already behave.

## Testing

- **Unit-tested** (new `tests/parse.test.ts` cases, extending the existing suite):
  `parseTaskLineWithSpans`'s offsets, across the same fixture categories `tests/fixtures/tasks.ts`
  already covers (canonical line, multi-project/context, the documented duplicate-`due:`
  ambiguity, completed tasks) — asserting each span's `[start, end)` slices the *original* line
  to exactly the expected substring. `detectMalformedPriority`'s shape detection: `[A]`, `{A}`,
  `<A>`, `(AA)`, `(1)` all detected; `(A)` (valid), `(a)` (valid-but-lowercase), and
  `- [ ] Buy milk [item]` (too long, not leading) all correctly return `null`.
- **Manually verified only** (`src/highlight.ts`, consistent with `view.ts`/`dateSuggest.ts`):
  actual CM6 registration, decoration rendering, cursor-inside-token behavior, Live
  Preview/Source-mode-only scoping, and the settings toggle's live effect.

## Open items for the implementation plan (not design decisions — just call out during planning)

- Exact CSS default colors for each new `@settings` entry (a placeholder palette, swappable).
- Whether toggling `enableInEditorHighlight` requires restarting the extension via a CM6
  `Compartment`/effect, or whether a "always registered, no-ops when disabled" approach is
  simpler — an implementation detail, not a design decision, but worth resolving explicitly in
  the plan rather than discovering it mid-task.
