# Inline field helper — Design

**Date:** 2026-10-14
**Status:** Draft, awaiting review

## Goal

Help the user enter a correctly formatted task line inline, by tapping suggestions instead of
remembering syntax. Mobile (Android) is the primary target, desktop second. The output is exactly
the plain todo.txt text a user would type by hand: no emojis, nothing that needs the plugin to be
read back.

## Research summary: the Tasks plugin

Tasks implements this as one Obsidian `EditorSuggest` (`EditorSuggestorPopup.ts`) fed by
`Suggestor.ts`:

- **Trigger:** any task line, cursor anywhere past the checkbox. There is no prefix gate.
- **Content:** if the cursor is inside a date-field-shaped match, it parses the typed text with
  chrono and offers concrete dates (`tomorrow (2026-10-15)`). Otherwise it offers a menu of fields
  not yet on the line (due, start, scheduled, recurrence, priority), using `line.includes(symbol)`
  checks. Results are filtered by the word under the cursor and capped by a setting.
- **Selection:** plain `replaceRange` plus `setCursor`. A synthetic `⏎` row is added because the
  popup swallows Enter; Tab is re-registered to keep indenting working.
- **What we take from it:** a discoverable menu, rather than recall of trigger syntax, is what
  makes this usable on a phone.
- **What we avoid:** field detection by parallel regex (violates "`parse.ts` is the single source
  of truth") and Enter/Tab hijacking.

## Current state

`src/dateSuggest.ts` already provides an `EditorSuggest` that triggers only after `due:`, `t:` or a
leading bare `:`. It is not discoverable: you must already know the trigger. `@context` and
`#context` are both first-class in the grammar (`DECISIONS.md`, 2026-10-03), with the prefix
preserved per token.

## Design

### Units

| Unit | Kind | Responsibility |
|---|---|---|
| `src/suggestFields.ts` | pure, unit-tested | Given a parsed `Task`, cursor offset and vocabulary, return the field-menu suggestions, each carrying a semantic edit. Omits fields already present. |
| `src/vocab.ts` | pure, unit-tested | Build frequency-ranked `+project`, `@name` and `#name` lists from parsed tasks. Names are kept per prefix. |
| `src/vocabIndex.ts` | Obsidian glue | Plugin-owned cache of the vocabulary. Lazy first scan of the vault (honouring `scanFolders`), then per-file updates on `modify`, `create`, `delete` and `rename`. |
| `src/triggers.ts` | pure, unit-tested | Decide which popup (if any) the cursor position opens, and which span a selection replaces. Holds the trigger-syntax regexes previously in `dateSuggest.ts`. |
| `src/taskSuggest.ts` | Obsidian glue | The single `EditorSuggest` (renamed from `dateSuggest.ts`), extended with the new triggers. |

`parse.ts` remains the only place the grammar is defined. Nothing in these units uses
task-syntax regexes of its own; trigger boundary checks use `parse.ts` exports
(`checkboxBodyStart`, `parseTaskLineWithSpans`).

The aggregated view's `scanVault()` is private to `view.ts` and only exists while the view is
open, so it cannot be reused. The view is left untouched in this change.

### Triggers

All apply to checkbox lines only (`parseTaskLine` non-null), and only at token boundaries as the
parser defines them.

| Trigger | Popup |
|---|---|
| Space after a word (setting) | Field menu: `Priority`, `Created`, `due:`, `t:`, `+ Project`, `@ Place`, `# Context`, minus fields already on the task |
| `+` | Known projects, filtered by what follows |
| `@` | Known `@` names, filtered by what follows |
| `#` | Not ours. Obsidian's native tag popup handles it. |
| `due:`, `t:`, leading `:` | Existing date popup, unchanged |

### Selection and chaining

- **Due / `t:`:** insert `due:` (or `t:`); the existing date trigger then fires, so the user
  finishes in two taps.
- **Created:** inserts today's ISO date directly in the leading slot (after any priority).
  Offered only on not-done tasks with no creation date. No sub-list; other dates come from the
  `due:` / `t:` / leading `:` popups.
- **Priority:** inserts a transient `!` and the same popup shows an A to E sub-list. Choosing a
  letter removes the `!query` and inserts `(X) ` in the leading slot (after the completion date
  on a done task). The edit is a local insertion computed from `parseTaskLineWithSpans`; the line
  is not re-serialised, so tokens the user is mid-typing are never reordered.
- **`+ Project` / `@ Place`:** insert the symbol; the vocabulary popup follows.
- **`# Context`:** inserts `#`; Obsidian's native popup takes over.
- **Vocabulary selection:** inserts the name with the prefix the user typed. A `@` name is never
  rewritten as `#` or vice versa.

### Edit and cursor correctness

- Every edit is computed from the semantic change to the parsed task; the new cursor position is
  derived from the edit, never reusing the pre-edit `{line, ch}` (SPEC.md cursor-drift lessons).
- Replacement spans cover only the typed query. Adjacent tokens are never consumed (the
  2026-10-04 `(A) :tod` bug class).
- Trigger matching requires the same boundary conditions the parser enforces (the 2026-09-20
  `#due:` bug class).

### Interference with the editor

- Enter and Tab pass through when the popup has nothing relevant. No synthetic `⏎` row.
- Esc dismisses. The popup never opens on non-task lines or in prose.
- Known limitation: while the field menu is showing (immediately after a typed space), Enter
  selects the highlighted row. The menu never appears on an empty body, can be dismissed with
  Esc, and can be switched off in settings.

### Settings

- Master toggle (exists today as the date-suggest toggle).
- "Show field menu on space", default on.
- Maximum items shown.

## Non-goals

A toolbar, a modal form, natural-language dates beyond the existing shortcuts, recurrence,
task dependencies, and unifying the aggregated view's scan with the vocabulary index.

## Verification

- **Unit tests (pure core):** field-presence rules per parsed task; vocabulary ranking and
  per-prefix separation; boundary conditions, including `#due:` and `(A) :tod` regressions;
  replacement spans; cursor derivation after each edit kind.
- **Live in Obsidian, desktop and Android:** each trigger; chaining from each menu row; priority
  sub-list; Enter, Tab and Esc behaviour; no popup on non-task lines.
- **Interop guard:** `#tag` still indexes in the tag pane and a Dataview `TASK` query still lists
  tasks after helper-built lines.

## Ranking

- **`+` and `@` popups:** names are ordered by how many vault tasks use them, most frequent
  first, so the 5 most-used names sit at the top. Ties break alphabetically. Typing filters the
  list; the frequency order is kept within the filtered results.
- **Field menu rows:** a fixed order (Priority, Date, `due:`, `t:`, `+ Project`, `@ Place`,
  `# Context`), with fields already on the task removed. No tap tracking, so no stored usage
  state.

## Open questions

None.
