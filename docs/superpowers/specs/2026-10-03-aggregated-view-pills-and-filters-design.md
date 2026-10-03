# Aggregated-view pills and project/context filtering — Design

> Written during a brainstorming session (architectural path). Self-contained: read this file
> plus `SPEC.md`/`DESIGN_RULES.md`/the sibling
> `2026-09-21-in-editor-highlighting-design.md` to implement, no other conversation context
> required.

## Why

The user compared `todotxt-md` against `mvgrimes/obsidian-todotxt-plugin`, which highlights
priority/project/context with colored pills and lets you filter by clicking one. Investigating
the comparison surfaced that `todotxt-md`'s grammar already fully supports `+project`/`#context`
(parsed, tested, documented — nothing was ever dropped from the grammar), and `aggregate.ts`
already has AND-semantics `projects: string[]` / `contexts: string[]` filter fields — but neither
is exposed anywhere:

- `view.ts`'s `formatTaskLabel()` renders an entire task as one flat `createSpan({text})` string.
  No color, no pills, no visual separation between priority/description/project/context/date.
- `view.ts`'s `renderFilterControls()` only offers a due-window `<select>` and an "include done"
  checkbox. The `projects`/`contexts` arrays on `AggregateFilter` are fully implemented in
  `aggregate.ts`'s filtering logic but have no UI path to ever become non-empty.

This design closes both gaps, and — since the sibling in-editor-highlighting design (paused
2026-09-21, resumed and widened in this session) needs the same project/context color info —
introduces one shared color module both surfaces consume.

This does **not** conflict with `DESIGN_RULES.md` §1.1/§1.2 for the same reason the sibling
spec's does not: pill rendering and filtering are a display/interaction layer over data
`aggregate.ts` already computes correctly. No stored line, no grammar, and no parse behavior
changes. A user with the plugin disabled still has fully legible, portable plain-text tasks.

## Scope

**In scope:**
1. A shared `src/tokenColors.ts` module: `nameToColor(name: string): string`, a deterministic
   hash over a fixed, small (~8–12 entry) hex palette pre-checked to read acceptably in both
   Obsidian's default light and dark themes. Pure, dependency-free (same "pure core" bar as
   `parse.ts`/`priority.ts`/`dates.ts`/`sort.ts` — importable from a plain Node test with no
   Obsidian mock), so it is unit-tested directly.
2. Aggregated-view row rendering (`view.ts`) rebuilt from one flat text span into structured
   child elements: a priority badge (if present), description text, one pill per project, one
   pill per context, and a date segment (creation/`due:`) — each its own classed element.
   Project/context pills are colored via `nameToColor`.
3. Click-to-filter: clicking a project or context pill toggles that name into/out of the active
   `AggregateFilter.projects`/`.contexts` arrays (AND semantics, already implemented in
   `aggregate.ts` — no change needed there). `stopPropagation()` prevents the pill click from
   also triggering the row's existing jump-to-source handler.
4. Active-filters chip bar: `renderFilterControls()` gains a row of removable chips, one per
   active project/context filter entry, alongside the existing due-window select and
   include-done checkbox. Clicking a chip's "×" removes just that filter entry.
5. A new plugin setting, `enableAggregatedViewPills: boolean` (default `true`), gating whether
   pills/colors render at all; when off, rows fall back to the current flat-text rendering
   (filtering by pill-click is naturally unavailable without pills, but the underlying
   `projects`/`contexts` filter fields remain usable by any future non-pill UI — out of scope
   here).

**Out of scope:**
- Any change to `aggregate.ts`'s filter *logic* — the AND-semantics arrays already work;
  only the UI to populate them from zero is new.
- Any change to `parse.ts` or the stored grammar.
- In-editor (CM6) decoration mechanics — fully specified in the sibling
  `2026-09-21-in-editor-highlighting-design.md`, which this design only amends (its project/
  context coloring now also uses `nameToColor`, see that file's 2026-10-03 amendment).
- A settings UI for manually assigning colors to specific project/context names. Rejected in
  favor of the zero-config hash approach (see Decisions below) — revisit only if users report
  the hash giving two important tags confusingly similar colors.
- Theme-variable-driven / Style-Settings-overridable pill colors. Rejected in favor of a fixed,
  pre-tested palette (see Decisions below).

## Decisions

### Per-name hash color, not Style Settings-configurable

Considered: (a) deterministic hash of the name into a fixed palette — chosen; (b) a
settings-tab mapping of project/context name → color, user-edited; (c) a fixed palette cycling
in first-seen order. (a) requires zero configuration and guarantees `+Finance` always renders
the same color across sessions and across both surfaces (editor + aggregated view) without the
user ever opening a settings screen. The accepted trade-off: the user doesn't choose which color
a given name gets, and two unrelated names could land on similar-looking palette slots at small
palette sizes. (b) was rejected as unnecessary upfront complexity — no user need for manual
color assignment has been expressed yet, and it's a backward-compatible additive settings feature
if ever requested later. (c) was rejected because "first-seen order" is unstable: a vault rescan
that encounters files in a different order (e.g. after a rename or new file) could reassign
colors between sessions, defeating the recognizability goal entirely.

### Fixed palette, not theme-aware hue/lightness computation

The palette is a literal list of hex strings in `tokenColors.ts`, chosen and manually checked to
have acceptable contrast against both Obsidian's default light and dark theme backgrounds. This
was chosen over computing lightness/saturation from Obsidian's theme CSS variables
(`--background-primary`, etc.) at render time: the fixed-list approach is simpler, needs no
per-theme logic, and the existing Style Settings integration (`styles.css`'s `@settings` block)
remains available as an escape hatch for the *other* (non-per-name) colors this project also
ships (date/done-line/malformed-priority, per the sibling spec) if a specific third-party theme
ever clashes badly. Revisit only if real-world theme clashes are reported — not a hypothetical
being designed around now.

### Two independent render paths, shared only via `tokenColors.ts`

The aggregated view builds real DOM elements (`createSpan`, `createDiv`); the in-editor feature
builds CM6 `Decoration.mark`s. These target fundamentally different rendering APIs, so there is
no shared "compute styled spans" function between them — each surface calls `nameToColor`
directly and builds its own output. This keeps both implementations simple to read in isolation,
at the cost of two call sites for the same color lookup (acceptable: the lookup itself is a
one-line pure function call, not meaningfully duplicated logic).

### Click-to-filter with a chip bar for removal, not toggle-in-place

Considered: (a) click a pill again to toggle it off — chosen against; (b) active filters shown
as removable chips in the filter-controls bar — chosen. (b) keeps the active-filter state
visible in one place even after scrolling past the row where you originally clicked, and cleanly
separates "browsing/adding a filter" (click any pill in the list) from "reviewing/removing what's
currently filtered" (the chip bar at the top). (a) was rejected because once a filter is active
and most non-matching rows are hidden, the *only* remaining pills bearing that name are already
filtered-in rows — awkward to re-find the specific pill to toggle versus always having a stable
removal control at the top.

## Architecture

### `src/tokenColors.ts` (new, pure core module)

```typescript
const PALETTE: readonly string[] = [
	// ~8-12 hex values, pre-checked against both default Obsidian themes.
	// Exact values are an implementation-plan detail, not a design decision.
];

/** Deterministic: same name always maps to the same palette entry. */
export function nameToColor(name: string): string {
	// Simple string hash (e.g. sum of char codes, or a small FNV-1a variant) mod PALETTE.length.
	// No requirement for cryptographic quality — only stability and a reasonable spread.
}
```

Unit-tested directly (new `tests/tokenColors.test.ts`): same name always yields the same color
across calls; different names are not all forced to the same slot (a basic spread sanity check
over a sample of realistic project/context names); empty string and unusual characters (spaces,
unicode) don't throw.

### `view.ts` changes

- `formatTaskLabel` (returns a single string today) is replaced by a `renderTaskRow(container,
  record)` that appends child elements directly to the row `item` div created in `render()`:
  priority badge span (if `task.priority`), description text span, a pill span per
  `task.projects` entry (class `todotxt-md-pill todotxt-md-pill-project`, inline color from
  `nameToColor`), a pill span per `task.contexts` entry (class `todotxt-md-pill
  todotxt-md-pill-context`), and the existing due-date/file-path trailing text.
- Each project/context pill gets a click listener: `evt.stopPropagation()`, then toggles the
  name in `this.filter.projects`/`.contexts` (push if absent, splice if present), then
  `this.render()`.
- `renderFilterControls` gains a chips row rendered from the current `this.filter.projects`/
  `.contexts` arrays: one removable chip per entry, each with a "×" that splices it out of the
  array and calls `this.render()`.
- Gated by `this.plugin.settings.enableAggregatedViewPills`: when false, `renderTaskRow` falls
  back to today's single-string `formatTaskLabel`-equivalent behavior and no pill click handlers
  or chip bar are attached.

### Settings (`main.ts` / settings tab)

New `enableAggregatedViewPills: boolean` (default `true`), same pattern as the sibling spec's
`enableInEditorHighlight` — validated/defaulted on load per `DESIGN_RULES.md` §4.4.

## Testing

- **Unit-tested:** `src/tokenColors.ts`'s `nameToColor` (pure, dependency-free, per above).
- **Unit-tested (existing suite, extended):** no change needed to `aggregate.ts`'s filter logic
  tests — `projects`/`contexts` AND-semantics are already covered in `tests/aggregate.test.ts`;
  this design only adds a UI path to populate those fields, not new filtering behavior.
- **Manually verified only** (`view.ts`, consistent with its existing testing posture): pill
  rendering, click-to-filter toggling, chip-bar removal, `stopPropagation` correctly preventing
  jump-to-source on pill click, and the settings toggle's fallback rendering.

## Open items for the implementation plan (not design decisions — just call out during planning)

- Exact hex values for the fixed palette (shared with the sibling in-editor spec — both specs
  must reference the same `tokenColors.ts`, implemented once).
- Exact hash function choice (any stable, reasonably-distributed string hash is acceptable; not
  a design-level decision).
- Whether pill/chip DOM elements need explicit `aria-pressed`/`role="button"` attributes for
  accessibility — worth resolving explicitly during planning rather than discovering it mid-task.
