# todotxt-md — Design Rules

> **Purpose.** `SPEC.md` describes *what v1 builds*. This file describes the *durable rules*
> that govern the codebase **beyond** the first plan — the invariants every future feature,
> refactor, and version must respect. When a decision in a future session conflicts with a
> rule here, either follow the rule or change the rule explicitly in this file (with a note on
> why). Do not silently violate it.
>
> See `DECISIONS.md` for the trade-off reasoning behind any rule marked `> changed:` below.

---

## 1. Product principles (the "why" — never trade these away)

1. **Plain text is the product.** Every task must remain fully legible, editable, and portable
   as raw text with no plugin installed — on desktop *and* Android. The plugin is a
   convenience layer over plain Markdown, never a container format. If a feature only works
   because the plugin is running, it must degrade to readable text when it isn't.
2. **No emojis, ever, in stored task text.** Emoji priority/date syntax (🔺⏫📅…) is the
   clutter this project exists to escape. Never write emojis into notes. UI chrome (the
   settings tab, an eventual view) stays visually minimal and text-first too.
   > **changed 2026-10-03:** display-only styling (color, underline) applied to existing
   > characters via CM6 decorations or DOM styling does not violate this rule — it never changes
   > stored text, introduces emoji, or adds new chrome. A task with in-editor highlighting or
   > aggregated-view pills is byte-identical when plugin is disabled and fully legible as plain
   > text.
3. **Keyboard-first.** Every user action must be reachable as a hotkey-bindable command. A
   feature that only works via mouse/context-menu is incomplete.
4. **Assist, don't nag.** The plugin helps format tasks (priority bumps, date expansion,
   sorting) but never blocks the user from typing free-form text or "corrupts" a line it
   doesn't understand. Unrecognized lines are left untouched.

## 2. The grammar is a contract

1. **One source of truth.** `src/parse.ts` (`parseTaskLine` / `serializeTask`) is the *only*
   place that knows the task grammar. No other module may parse or emit task syntax with ad-hoc
   regex. Priority/date/project/context logic operates on the parsed `Task` object, not raw
   strings.
2. **Round-trip fidelity.** `serializeTask(parseTaskLine(line))` must reproduce a
   semantically-equivalent line. Parsing then serializing an untouched task must not reorder or
   drop tokens the user wrote (beyond canonicalization the user opted into). Any grammar change
   ships with round-trip tests.
3. **Canonical token order** (from `SPEC.md`): `[checkbox] (PRIO) [completion-date]
   [creation-date] description +Project #context due:YYYY-MM-DD [t:YYYY-MM-DD]`. Deviations a
   user typed by hand are preserved on read; canonical order is only enforced when the plugin
   rewrites a line.
4. **Deliberate deviations from pure todo.txt are documented, not accidental.** Current
   deviations: contexts use `#tag` (not `@context`). Any new deviation must be recorded in
   `SPEC.md`'s decisions table with a one-line rationale.
5. **Dates are ISO `YYYY-MM-DD` in storage.** Human shortcuts (`tod`, `tom`, weekdays,
   `+3d`) are *input conveniences* expanded at edit time — they are never persisted.

## 3. Architecture rules

1. **Pure core, thin glue.** Business logic lives in dependency-free modules (`parse`,
   `priority`, `dates`, `sort`) that import nothing from `obsidian`. Obsidian-specific code
   (`main.ts`, `editor.ts`, `view.ts`) is a thin adapter that calls the pure core. Test:
   *could this function run in a plain Node test with no Obsidian mock?* If it's core logic,
   the answer must be yes.
2. **Determinism for testability.** Anything time-dependent takes an injectable "now"/clock;
   never call `new Date()` directly inside core logic. Sorting must be stable and total (define
   tie-breakers so output is deterministic).
3. **Edits preserve the user's cursor and indentation.** Any in-place rewrite (`editor.ts`)
   must restore a sensible cursor position and preserve leading whitespace / list nesting of
   each line. Never reflow or reindent lines the operation didn't target.
4. **Operate on the minimal scope.** Line-level commands touch only the cursor's line;
   block-level commands (sort) touch only the contiguous checkbox block (a blank line or
   non-task line bounds it). Never rewrite a whole note unless the user explicitly invoked a
   "whole note" action.
5. **No runtime dependency on other task plugins.** Tasks/Dataview/Task Genius interop is
   "best-effort via shared plain-text conventions," never a hard dependency. The plugin must
   function fully with none of them installed. > **changed 2026-09-20:** Dataview due-date
   field-querying was investigated and confirmed unreachable without bracketed `[key:: value]`
   syntax or Tasks-plugin emoji — both rejected as incompatible with rule 2 above. The plugin's
   own aggregated view (`src/view.ts`) is the supported way to query tasks by due date instead;
   see `DECISIONS.md` (2026-09-20 entry) for the full trade-off.

## 4. Coding conventions

1. **TypeScript strict mode on.** No `any` in the core modules; model the `Task` shape
   explicitly. Prefer exhaustive `switch`/discriminated unions over loose string checks.
2. **Match Obsidian plugin idioms.** Register everything through the `Plugin` lifecycle
   (`addCommand`, `addSettingTab`, `registerEvent`) and unregister/clean up on unload — no
   leaked listeners or intervals.
3. **Small, named, pure functions** over large stateful classes in the core. Comment density
   matches the surrounding code; explain *why*, not *what*.
4. **Settings have safe defaults and are validated on load.** A missing or malformed setting
   falls back to a sane default rather than throwing.

## 5. Testing & verification rules

1. **Core logic is unit-tested; every grammar or behavior change adds/updates a test.** The
   parse/priority/dates/sort modules carry the test burden — that's where bugs live.
2. **A change to task-editing behavior is not "done" until exercised in Obsidian**, not just
   green unit tests — per the verification checklist in `SPEC.md`.
3. **Interop regression guard:** after grammar changes, re-confirm `#tag` tags still index in
   Obsidian and a basic Dataview `TASK` query still lists tasks.

## 6. Scope discipline

1. **Ship v1 before v1.5.** Anything not in `SPEC.md`'s v1 list waits until v1 is in daily use.
   Resist scope creep into the first release. > **changed 2026-09-20:** the aggregated
   cross-file view was moved from v1.5 into v1 as a deliberate, one-time exception — it became
   the plugin's replacement for Dataview due-date querying (rule 3.5 above), not a scope-creep
   addition. v1.5 is otherwise still deferred; this does not reopen the door to other v1.5 items
   moving up without an equally explicit reason. See `DECISIONS.md` (2026-09-20 entry).
2. **Desktop-first.** Don't add desktop-only APIs that would make the format or core unusable
   on Android; but mobile-specific *UX* is explicitly out of scope until desktop is solid.

## 7. Changing these rules

This document is versioned with the code. When a rule genuinely needs to change:
- edit it here in the same commit as the code that depends on the change,
- note the reason inline (a short `> changed: …` blockquote is fine),
- and, if it alters the stored grammar, reflect it in `SPEC.md`'s decisions table too.

A rule that's been silently broken by code is a bug in one of the two — reconcile them, don't
leave them in conflict.
