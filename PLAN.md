# todotxt-md — Build Plan

> **This file is the complete build brief.** It was written during a brainstorming session
> and is intentionally self-contained: a fresh Claude Code session opened in this folder
> should be able to build the plugin from this file alone, with no prior conversation context.
> Read it top to bottom before writing code.
>
> **Also read `DECISIONS.md`** — it records decisions that reversed or materially bent a rule
> here after this file was first written (e.g. the 2026-09-20 decision to drop Dataview
> due-date interop and pull the aggregated view into v1). This file has been updated to reflect
> those decisions, but `DECISIONS.md` has the trade-off reasoning if you need the "why."

---

## Start here (fresh session)

You are building an **Obsidian community plugin** called **`todotxt-md`**. The folder you are
in (`C:\Users\apdev\Documents\github\obsidian\todotxt-md`) already exists and is the git repo
for this plugin (`git init` has been run; the planning docs are the first commit). Do this in
order:

1. Read this entire file, then read **`DESIGN_RULES.md`** — that file holds the durable rules
   (grammar contract, pure-core architecture, plain-text/no-emoji principles) that govern all
   development, not just v1. Follow it throughout.
2. Scaffold the plugin files (see **Critical files**) and commit the scaffold separately from
   the planning-docs commit.
3. Build on **Windows** — do **not** use WSL (reasoning below).
4. Implement **v1 scope** only. Defer v1.5.
5. Wire the vault symlink for hot-reload (see **Deployment / dev loop**), then verify
   end-to-end (see **Verification**).

**Development environment:** Windows 11, PowerShell primary shell. Toolchain is Node +
TypeScript + esbuild + the Obsidian API — all run natively on Windows.

---

## Context — why this plugin exists

The user manages tasks in Obsidian and has tried the **Tasks** and **Task Genius** plugins.
They like being able to create a task anywhere and aggregate them (Tasks + Dataview), and they
like aspects of Task Genius — but both feel **cluttered and emoji-heavy** in their UI.

They want the ergonomics of a classic **todo.txt** app (as on Windows/Android) *inside*
Obsidian: assisted todo.txt-style formatting, keyboard shortcuts to bump priority, quick date
entry (`tod` → today), and in-line sorting — but with a **clean, plain-text, no-emoji**
presentation. No existing plugin does this (see landscape below), so we build a custom one.

### Competitive landscape (searched 2026-09-19 — the gap is confirmed real)

The ecosystem splits into two camps; this project falls **between** them:

- **Dedicated-file todo.txt plugins** — [rioskit/obsidian-todo-txt-mode](https://github.com/rioskit/obsidian-todo-txt-mode)
  and [mvgrimes/obsidian-todotxt-plugin](https://github.com/mvgrimes/obsidian-todotxt-plugin).
  Both operate **only on dedicated `.todotxt` files**, not Markdown checkboxes in normal notes.
  Neither has priority hotkeys, `tod` date shortcuts, or `#tag` contexts. Breaks the "create a
  task anywhere as a normal checkbox" requirement.
- **In-place Markdown-checkbox plugins** — [artem98/obsidian_tasks_sort](https://github.com/artem98/obsidian_tasks_sort)
  (physically sorts the checkbox block under the cursor) and **Prioritize**
  (set/remove/increase/decrease priority via hotkey-bindable commands). Both use the
  **Tasks-plugin emoji syntax** (🔺⏫🔼📅) — the exact clutter the user is escaping — and each
  does only *one* of the three wanted features.

**No plugin combines** Markdown checkboxes + emoji-free todo.txt tokens + priority hotkeys +
`tod`/`tom` date expansion + in-place sort + `#tag` contexts.

**Reuse stance (user-confirmed): reference only, build clean.** No runtime dependency on any
existing plugin. Two are worth *reading* during implementation:
- `artem98/obsidian_tasks_sort` — already solves the trickiest editor mechanic: detecting the
  contiguous checkbox block under the cursor and rewriting lines in place. Its block-detection
  and line-rewrite approach informs `sort.ts`/`editor.ts` (ignore its emoji-priority logic).
- `Prioritize` — its set/remove/increase/decrease command structure validates the v1 command
  design.

---

## Settled decisions (do not re-litigate)

| Decision | Choice | Notes |
|---|---|---|
| Plugin ID / folder | `todotxt-md` | lowercase-hyphenated; must NOT start with `obsidian-` (Obsidian guideline); `manifest.json` `id` must match folder name |
| Display name | `Todo.txt MD` | shown in Settings |
| Storage format | Markdown checkboxes (`- [ ]`) with todo.txt-flavored tokens | hybrid — keep todo.txt look, map tokens so Tasks/Dataview can still read them where feasible |
| Priority syntax | `(A)`–`(Z)` | pure todo.txt |
| Projects | `+Project` | pure todo.txt |
| Contexts | `#tag` | **deliberate deviation** from todo.txt `@context` — uses Obsidian-native tags |
| Dates | `due:YYYY-MM-DD` (ISO); optional `t:` threshold | **Not core todo.txt** (corrected 2026-09-20 — see `DECISIONS.md`): the official spec (github.com/todotxt/todo.txt) defines only priority, creation date, completion date, `+project`, `@context` as native fields. `key:value` is a spec'd *extension mechanism* for tool developers, and `due:2010-01-02` is literally the spec's own example of that mechanism — so `due:` is "the spec's documented extension pattern, used as intended," not core grammar and not an invented deviation either. Human-readable inline text. **Not Dataview-queryable** — Dataview only recognizes bracketed `[key:: value]` fields or a hardcoded set of Tasks-plugin emoji, neither of which this bare `key:value` form uses (confirmed empirically 2026-09-20; see `DECISIONS.md`). This is an accepted trade-off, not a bug: the plugin's own aggregated view (below) is the supported way to query by due date. |
| Location model | one file per "project area" (`Work.md`, `Personal.md`), primary; ad-hoc tasks in daily notes; aggregated view is **v1 scope** (moved up from v1.5 on 2026-09-20 — see `DECISIONS.md`) | |
| Platform | **Desktop-first (Windows)** | format stays plain-text so Android reads/edits it; no mobile-specific UX in v1 |
| Aesthetic | clean, keyboard-first, **no emojis**, looks like plain text | this is the whole point |
| Build vs configure | full TypeScript community plugin | configuring Tasks/Task Genius was rejected — their UI is the problem |
| Recurring tasks (`rec:`) | **out of scope for v1 and v1.5** | not a todo.txt-core feature the user asked for; revisit only if a future need arises — add `rec:` to the grammar table and bump `DESIGN_RULES.md`'s grammar version when it does |
| Sub-tasks / nested indentation | **not part of the grammar** — a checkbox's indentation is preserved as opaque whitespace (per `DESIGN_RULES.md` §3.3) but nesting has no semantic meaning (no parent/child rollup, no indent-aware sort). Each checkbox line is parsed independently | avoids scope creep into a task-hierarchy feature nobody asked for; a plain nested checklist still displays fine, it's just not "aware" |

### Environment: Windows, not WSL

The vault is mounted on Windows; Obsidian is a Windows Electron app reading a Windows
filesystem — the plugin never touches WSL at runtime. WSL dev would force cross-boundary I/O
(`/mnt/c` or `\\wsl$`), break native file-watch/hot-reload, and add line-ending friction for
zero benefit. **Develop, build, and deploy entirely on Windows.**

---

## Task line grammar (the contract)

A task is any Markdown list item that is a checkbox. Canonical token order:

```
- [ ] (A) 2026-09-19 Call the bank about the loan +Finance #calls due:2026-09-25
      ^prio ^creation-date   ^description          ^project ^ctx  ^due
- [x] 2026-09-20 (A) 2026-09-19 Renewed passport +Admin
      ^completion-date, then original priority/creation preserved (todo.txt done convention)
```

- **Priority:** `(A)`–`(Z)` immediately after the checkbox. Absence = no priority.
- **Dates:** ISO `YYYY-MM-DD`. `due:` is the key date field, using todo.txt's spec'd
  `key:value` extension mechanism (see "Interop note" below — not a core spec field, but the
  spec's own documented example); optionally support `t:` (threshold/start), the same
  mechanism. Bare leading date = creation date (this one **is** core todo.txt spec).
- **Projects:** `+Project` (todo.txt-native; Dataview indexes as inline text — acceptable).
- **Contexts:** `#tag` (deviation — Obsidian-native, so tag pane / search / Dataview all work
  for free).
- **Completion:** toggling `- [ ]` → `- [x]` prepends completion date; toggling back removes
  it. Priority is preserved inline (see "Settled micro-decisions" below).

**Grammar provenance correction (2026-09-20 — see `DECISIONS.md`):** earlier drafts of this
file called `due:` "pure todo.txt." That's imprecise. Per the official spec
(github.com/todotxt/todo.txt), the *core* format defines only priority, creation date,
completion date, `+project`, `@context` — no due-date field. The spec separately defines a
generic `key:value` **extension mechanism** for tool developers, and its own worked example is
literally `due:2010-01-02`. So `due:` is "the spec's documented extension pattern, applied
exactly as the spec illustrates it" — not core grammar, but also not an invented convention;
it's arguably the most standard possible choice for a due-date field precisely because it's the
spec's own example. `t:` (threshold) is the same mechanism, a widely-used ecosystem convention
(e.g. todo.txt-cli add-ons, SwiftoDo) built on the same `key:value` pattern.

**Interop note (hybrid mapping, revised 2026-09-20 — see `DECISIONS.md`):** the checkbox itself
is what Tasks/Dataview see as a task, and that part still works — a plain Dataview `TASK` query
lists our tasks fine, and `#tag` contexts are natively indexed for free. `due:YYYY-MM-DD` is
human-readable but **not Dataview-field-queryable** — confirmed empirically that Dataview only
parses bracketed `[key:: value]` fields or a hardcoded set of Tasks-plugin calendar emoji
(📅/📆/🗓️) as queryable fields, and our bare `key:value`-style `due:` token is neither. We are
*not* adopting the Tasks-plugin emoji date syntax — that's the clutter being escaped, and it's
the only automatic route to Dataview due-date queries, so we decline it and don't get that
capability from Dataview. Instead, the plugin's own aggregated view (v1 scope, see below) is the
supported way to filter/sort by due date, `#context`, or `+project` — it doesn't depend on
Dataview being installed at all, consistent with "best-effort, no hard dependency"
(`DESIGN_RULES.md` §3.5).

### Parse leniency contract (malformed/partial input)

`parseTaskLine` must have a defined answer for every input, not just the canonical case. The
rule: **`parseTaskLine` recognizes a line as a task iff it is a Markdown checkbox
(`- [ ]`/`- [x]`, any leading indentation)** — that's the only gate. Once a line passes the
checkbox gate, parsing of the *body* (everything after the checkbox marker) is **best-effort
and always succeeds**, never returns `null` for the body itself. Tokens matching
priority/date/project/context patterns anywhere in the body are extracted into their `Task`
fields **in the position/order they appear**; everything else — including out-of-place tokens,
duplicates, and free text — is preserved verbatim in an `extra`/raw-remainder field so
`serializeTask` can round-trip it. Concretely:

| Input | Behavior |
|---|---|
| `- [ ] Call the bank` | Parses fine; no priority/dates/project/context; `description` = full text. |
| `- [ ] Call (A) the bank` | `(A)` is **not** treated as priority — priority is only recognized in the leading position immediately after the checkbox (see grammar above). It stays in `description` as literal text. This is a position rule, not a "looks like priority" rule. |
| `- [ ] (A) (B) Call the bank` | First `(A)` is the priority. Second `(B)` is left in `description` as literal text (only one priority token is ever recognized, at the leading position). |
| `- [ ] Call the bank due:2026-09-25 due:2026-09-30` | First `due:` wins and populates `Task.due`; the second `due:2026-09-30` is left in `description` as literal text (not silently dropped, not silently overwritten-then-discarded). **Known grammar ambiguity:** `serializeTask` writes canonical order, so the literal `due:2026-09-30` (now part of `description`) is emitted *before* the structured `due:2026-09-25` field — a rewrite this plugin performs reorders duplicate-looking tokens, same as it would reorder any other token relative to hand-typed order (`DESIGN_RULES.md` section 2.3). Re-parsing the rewritten line swaps which `due:` is "the field" vs. literal text. No data is lost (both values persist across any number of rewrites), but which one is structured vs. literal is not stable under repeated edits. Accepted as an inherent ambiguity of duplicate keys, not a bug; see `tests/fixtures/tasks.ts`'s `skipRoundTrip` flag. |
| `- [ ] +Proj1 +Proj2 Call the bank` | **Multiple `+Project`/`#context` tokens are all captured**, in the order they appear, into `Task.projects: string[]` / `Task.contexts: string[]` (not deduplicated, not sorted — user's order is preserved on round-trip). |
| `- [ ] due:2026-9-5 Call the bank` | Non-ISO date (`2026-9-5`, not zero-padded) is **not** recognized as a valid `due:` token — left as literal text in `description`. Only strict `YYYY-MM-DD` is extracted. This avoids silently "fixing" a date the user may have meant differently. |
| `- [ ] ` (checkbox, empty body) | Valid `Task` with empty `description` and no other fields. Not `null`. |
| `Call the bank` (no checkbox) | Returns `null` — not a task line at all. Left completely untouched by every command (per `DESIGN_RULES.md` §1.4). |

This makes the checkbox-gate/best-effort-body split the actual contract: **"unrecognized lines
are left untouched" (`DESIGN_RULES.md:24`) applies at the whole-line level (no checkbox = null =
hands off); everything inside a checkbox line is always parseable, with anything the grammar
doesn't recognize preserved as literal text rather than dropped.** This guarantees round-trip
fidelity even for messy input, and gives `parse.test.ts` a concrete fixture table to start from
(see also "Multiple projects/contexts" and "Completion" below).

**Completion field handling:** toggling `- [ ]` → `- [x]` prepends the completion date and
**leaves `due:`/`t:` untouched** — a completed task keeps its due date as a historical record
(consistent with plain todo.txt convention; also lets the plugin's own aggregated view compute
"completed late" by comparing `due:` vs. completion date — not a Dataview query, per the
2026-09-20 interop revision above). Toggling back off removes the completion date and restores
the line exactly as it was (round-trip via the preserved original token order).

---

## Architecture (keep logic pure, glue thin)

Standard Obsidian plugin scaffold. Module layout:

- `src/main.ts` — plugin entry: register commands, hotkeys, settings tab, (later) view.
- `src/parse.ts` — pure: `parseTaskLine(text) → Task | null`, `serializeTask(Task) → string`.
  **Single source of truth for the grammar.** No Obsidian import; fully unit-testable.
- `src/priority.ts` — `bumpPriority(task, +1|-1)` cycling `(A)…(Z)`/none.
- `src/dates.ts` — token expansion: `tod`→today, `tom`→tomorrow, `mon`/`tue`/…→next weekday,
  `+3d`/`+1w`→relative. Pure + testable (inject a "today" clock so tests are deterministic).
- `src/sort.ts` — `sortLines(lines[], comparator)`; default comparator = priority asc, then
  `due` asc, then creation date. Operates on a contiguous list block. **Read
  `artem98/obsidian_tasks_sort` first** for cursor-block detection (blank line / non-task line
  ends the block) and the in-place line-rewrite technique.
- `src/editor.ts` — Obsidian `Editor` glue: find current task line / current list block, apply
  the pure transforms, write back **preserving indentation and cursor position**.
- `src/view.ts` — **v1 scope** (moved up from v1.5 on 2026-09-20, see `DECISIONS.md`) —
  aggregated `ItemView`: scans project files + daily notes via the vault API, parses each
  checkbox with `parse.ts`, renders a sortable/filterable flat list (filter by `#context`,
  `+project`, due window). Clicking a task jumps to its source line. This is the plugin's
  answer to "query my tasks across files," replacing the Dataview-due-date-query capability
  that turned out to be unreachable without brackets or emoji (see "Interop note" above).

Keeping all logic in the pure modules is what makes the grammar reliable and the whole thing
testable without launching Obsidian.

### Editor mechanics — the real risk in `editor.ts`

The referenced plugin (`artem98/obsidian_tasks_sort`) is useful **only for its block-detection
logic** (finding the contiguous checkbox block via blank-line/non-task-line boundaries) — treat
that as the sole thing to port by reading, not the rewrite mechanism itself. The actual risk in
`editor.ts` is CodeMirror 6 transaction handling, which the sort-plugin reference does not solve
for us in general:

- **All edits must go through CM6 transactions** (`editor.replaceRange` / the CM6
  `dispatch`/`changes` API that Obsidian's `Editor` wraps), never direct string mutation of the
  document outside that API — otherwise undo history and other CM6 state (e.g. syntax
  highlighting overlays) desyncs from the document.
- **Cursor offset must be recomputed, not assumed stable, whenever a rewritten line changes
  length.** Priority bumps (`(A)`→`(B)`) never change line length, but several v1 operations do:
    - Date expansion (`tod` → `2026-09-19`) changes length by construction.
    - Sort reorders lines, so "the cursor's line" after rewrite is a different line index than
      before — the cursor must be re-anchored to *the same task* (e.g., by tracking the task's
      original text/id through the sort), not to "line N," or it will silently jump to whatever
      task now occupies that line number.
    - Toggle-done prepends a date token, shifting every character after it — if the cursor was
      mid-description, its column offset must shift by the prepended length, not stay fixed.
  Concretely: compute the new cursor position from the semantic edit (which token was
  inserted/removed and where) rather than reusing the pre-edit `{line, ch}` unchanged.
- **No-op safety:** every command must check for an active Markdown editor and a checkbox line
  under the cursor (via `parseTaskLine` returning non-`null`) before attempting any transform,
  and do nothing (no error, no notice) if either check fails — consistent with "assist, don't
  nag" (`DESIGN_RULES.md` §1.4).
- **Live-typing expansion (v1's deferred stretch goal) is architecturally different work**, not
  a small follow-on to the explicit command: it requires an `EditorSuggest` or a CM6 transaction
  filter/extension registered via `registerEditorExtension`, which intercepts keystrokes rather
  than running on command invocation. Budget it as a separate implementation task if/when it's
  picked up, not an afterthought once the explicit command works.

**Built 2026-09-20** (`src/dateSuggest.ts`, see
`docs/superpowers/plans/2026-09-20-date-suggest-and-aggregated-view.md`): live-typing expansion
was implemented via `EditorSuggest`, and manual testing surfaced exactly the kind of subtle
trigger-boundary bug this section warns about in the abstract — the first version's trigger
regex matched `due:`/`t:` as a bare substring anywhere in the line, so a `#due` or `#t` context
tag followed by a colon (e.g. `#due:tod`) incorrectly fired the popup. Fixed by requiring the
`due:`/`t:` prefix to start at a word boundary (line-start or preceding whitespace), matching how
`parse.ts`'s tokenizer actually recognizes the field. Lesson for future `EditorSuggest`/CM6
trigger logic: **substring matches on grammar tokens are not enough — always require the same
boundary conditions the parser itself enforces**, or the trigger will fire in contexts the
grammar wouldn't recognize as that token.

---

## v1 scope (ship this first)

Commands (all hotkey-bindable, all operating on the cursor's current line/block):

1. **Increase / Decrease priority** — `bumpPriority`. On a task with no priority, "increase"
   starts at `(A)` (settled default — see "Settled micro-decisions").
2. **Date shortcut expansion** — an editor command *and* an optional as-you-type trigger:
   typing `tod ` in a `due:` position expands to the ISO date. Start with an explicit "expand
   date token" command to avoid fighting the editor; add live expansion later if it feels good.
   `dates.ts` owns the mapping.
3. **Sort current list** — `sortLines` over the contiguous checkbox block the cursor is in,
   rewritten in place. Setting: also offer "sort whole note".
4. **Toggle done** — prepend/strip completion date (native toggle exists, but ours enforces the
   date convention).
5. **Aggregated view** (moved up from v1.5 on 2026-09-20 — see `DECISIONS.md`) — an `ItemView`
   scanning project files + daily notes, parsing each checkbox with `parse.ts`, rendering a
   sortable/filterable flat list (filter by `#context`, `+project`, due window). Clicking a task
   jumps to its source line. This is the primary vehicle for querying tasks by due date, since
   Dataview cannot field-query our bare `due:` syntax (see "Interop note" above).

**Settings tab:** default new-task priority; whether increase-from-none jumps to `(A)`; date
format (ISO fixed for v1); sort comparator order; weekday token list.

**Testing:** Vitest unit tests for `parse`, `priority`, `dates`, `sort` (settled — see "Settled
micro-decisions") — these cover the grammar contract and are where bugs will actually live. The
aggregated view is exercised manually in Obsidian per the Verification section below, since it
depends on vault-scanning APIs that aren't part of the pure core.

---

## v1.5 scope (after v1 is in daily use — do NOT build in v1)

Currently empty. The aggregated cross-file view — the only item previously listed here — was
pulled into v1 on 2026-09-20 (see `DECISIONS.md` and v1 scope item 5 above) because it became
the plugin's answer to task querying once Dataview due-date interop was dropped. Future
deferred features go here as they're identified; none are currently planned.

---

## Deployment / dev loop (Windows)

- Symlink (or point the esbuild output dir) to `<vault>/.obsidian/plugins/todotxt-md/` so
  `npm run dev` (esbuild watch) rebuilds straight into the vault. **Ask the user for the vault
  path** — it is not recorded here.
  - PowerShell symlink example (run once, adjust the vault path):
    `New-Item -ItemType SymbolicLink -Path "<VAULT>\.obsidian\plugins\todotxt-md" -Target "C:\Users\apdev\Documents\github\obsidian\todotxt-md"`
    (creating a symlink may require Developer Mode or an elevated shell on Windows).
  - **Fallback if symlinking isn't available** (Developer Mode off, non-elevated shell): add an
    `npm run dev:copy` script that copies `main.js`/`manifest.json`/`styles.css` into the vault
    plugin folder on each build instead of symlinking (e.g. via a small Node `fs.copyFile` step
    or `esbuild`'s `onEnd` plugin hook) — loses true hot-reload-on-save but unblocks dev loop
    setup without elevated permissions.
- Use the community **Hot Reload** dev plugin for instant reload during iteration (works
  natively because everything is on the Windows FS).
- `manifest.json` `isDesktopOnly` can stay `false` (format is plain-text-safe on mobile), but
  do **not** test/support mobile UX in v1.

---

## Critical files to create

- `manifest.json` (`id: "todotxt-md"`, `name: "Todo.txt MD"`, `minAppVersion: "1.4.0"` — targets
  a recent stable Obsidian release with the CM6 editor API surface the plan's editor mechanics
  section relies on), `package.json` (`engines.node: ">=18"`), `esbuild.config.mjs`,
  `tsconfig.json` (`"strict": true`), `versions.json`
- `.nvmrc` pinning Node 18 (matches `engines.node`, keeps local dev reproducible)
- **Test runner: Vitest** (settled — not Jest). Rationale: native ESM, no transform config
  needed alongside esbuild, faster watch-mode iteration for a TDD-style core-module workflow.
  Add `vitest.config.ts` and a `test`/`test:watch` script in `package.json`.
- **Lint/format tooling:** `.eslintrc` (or flat `eslint.config.js`) with
  `@typescript-eslint/no-explicit-any: "error"` scoped to `src/parse.ts`, `src/priority.ts`,
  `src/dates.ts`, `src/sort.ts` (the pure core) — this makes "no `any` in core modules"
  (`DESIGN_RULES.md` §4.1) a build-time check instead of an honor-system rule. Prettier (or
  ESLint's formatting rules) for consistent style; wire both into a `npm run lint` script.
- `src/main.ts`, `src/parse.ts`, `src/priority.ts`, `src/dates.ts`, `src/sort.ts`,
  `src/editor.ts`, `src/view.ts` (moved into v1 on 2026-09-20, see `DECISIONS.md` —
  aggregated cross-file `ItemView` with filter/sort by `#context`/`+project`/due window)
- `styles.css` (minimal — deliberately no decorative styling)
- `tests/parse.test.ts`, `tests/dates.test.ts`, `tests/priority.test.ts`,
  `tests/sort.test.ts` (`view.ts` is exercised manually per Verification step 5, not unit
  tested — it's vault-scanning Obsidian glue, not pure core)
- `tests/fixtures/tasks.ts` — a shared array of `{ raw: string, parsed: Task }` fixture pairs
  covering the parse-leniency table above (canonical lines, malformed input, multi-project,
  completion). `parse.test.ts` and `sort.test.ts` both import from here so round-trip ground
  truth can't drift between test files.
- `.gitignore` (node_modules, main.js build output, etc.)

---

## Verification (end-to-end — do all five)

1. **Unit tests pass:** round-trip `parseTaskLine`↔`serializeTask` on a fixture set covering
   priority, dates, `+project`, `#context`, completion; `dates.ts` token expansion against a
   fixed clock; `sort.ts` ordering; `priority.ts` cycling including the none↔`(A)` edges.
2. **In Obsidian (Windows):** create `Work.md`, add several `- [ ]` tasks. Verify each hotkey:
   priority up/down changes `(A)`↔`(B)`↔none on the cursor line; `tod`/`tom`/weekday tokens
   expand to correct ISO dates; sort reorders the block by priority→due; toggle-done prepends
   today's completion date.
3. **Interop check (revised 2026-09-20 — see `DECISIONS.md`):** confirm `#context` tags appear
   in Obsidian's tag pane, and a simple Dataview `TASK` query still lists the tasks (proving
   existing checkbox-based workflows aren't broken). **Do not** expect a Dataview field query on
   `due:` to return filtered results — this was tried and confirmed not to work (Dataview only
   recognizes bracketed `[key:: value]` fields or specific Tasks-plugin emoji, neither of which
   our bare `due:` syntax is). That capability is intentionally provided by the plugin's own
   aggregated view instead — verify due-date filtering there (step 5 below), not via Dataview.
4. **Plain-text/Android safety:** open the file's raw text — confirm it's clean, emoji-free,
   and legible as a portable todo list.
5. **Aggregated view (new 2026-09-20 — see `DECISIONS.md`):** with tasks spread across at least
   two files (e.g. `Work.md` and a daily note), open the view and confirm it lists tasks from
   both; filtering by `#context` and `+project` narrows the list correctly; filtering/sorting by
   due window (e.g. "due this week") matches only tasks with an in-range `due:` value; clicking
   a task jumps the editor to its exact source line in the correct file.

---

## Settled micro-decisions

- **Completion preserves `(A)` inline** (not moved to `pri:A`) — matches the example in the
  grammar section (`PLAN.md:101-103`) and keeps the line readable as plain text, which is the
  whole point (`DESIGN_RULES.md` §1.1).
- **Explicit "expand date token" command ships first; live-typing expansion is deferred**, and
  is architecturally separate work (see "Editor mechanics" above) — not picked up casually as a
  follow-on.
- **Default priority when increasing from none is `(A)`** — matches todo.txt convention
  (highest priority first) and needs no extra explanation in the settings tab; a configurable
  override remains available per the v1 settings-tab scope.
