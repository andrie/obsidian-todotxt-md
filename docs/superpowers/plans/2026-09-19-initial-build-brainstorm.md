# Plan: `todotxt-md` — a clean, keyboard-driven todo.txt plugin for Obsidian

## Project identity & location

- **Plugin ID / folder name:** `todotxt-md` (lowercase-hyphenated; does not start with
  `obsidian-`, per Obsidian's community-plugin guideline; `manifest.json` `id` matches).
- **Display name:** `Todo.txt MD`.
- **Dev workspace (git repo):** `C:\Users\apdev\Documents\github\obsidian\todotxt-md` — a
  clean, standalone repo, separate from the Obsidian vault. The `obsidian\` parent dir may
  need creating.
- **Vault link:** build output is symlinked into
  `<vault>/.obsidian/plugins/todotxt-md/` (see Deployment section) so the dev repo stays
  decoupled from the vault while still hot-reloading into it.
- **First setup steps for the executing session:** create the folder, `git init`, scaffold
  the plugin (see Critical files), then create the symlink into the vault.

## Context

The user manages tasks in Obsidian and has tried the **Tasks** and **Task Genius** plugins.
They like being able to create a task anywhere and aggregate them (Tasks + Dataview), and
they like aspects of Task Genius — but both feel cluttered and emoji-heavy in their UI.

What they actually want is the ergonomics of a classic **todo.txt** app (as found on Windows
and Android) *inside* Obsidian: enforced/assisted todo.txt-style formatting, keyboard
shortcuts to bump priority, quick date entry (`tod` → today), and in-line sorting — but with
a clean, plain-text, no-emoji presentation. No existing Obsidian plugin does this well, so we
are building a custom **community plugin** in TypeScript.

### Competitive landscape (searched 2026-09-19 — confirmed the gap is real)

The ecosystem splits into two camps, and this project falls **between** them:

- **Dedicated-file todo.txt plugins** — [rioskit/obsidian-todo-txt-mode](https://github.com/rioskit/obsidian-todo-txt-mode)
  and [mvgrimes/obsidian-todotxt-plugin](https://github.com/mvgrimes/obsidian-todotxt-plugin).
  Both operate **only on dedicated `.todotxt` files**, not Markdown checkboxes in normal
  notes. Neither has priority hotkeys, `tod` date shortcuts, or `#tag` contexts. This breaks
  the "create a task anywhere as a normal checkbox" requirement.
- **In-place Markdown-checkbox plugins** — [artem98/obsidian_tasks_sort](https://github.com/artem98/obsidian_tasks_sort)
  (physically sorts the checkbox block under the cursor) and **Prioritize** (set/remove/
  increase/decrease priority via hotkey-bindable commands). Both use the **Tasks-plugin
  emoji syntax** (🔺⏫🔼📅) — the exact clutter the user is escaping — and each does only
  *one* of the three wanted features.

**No plugin combines** Markdown checkboxes + emoji-free todo.txt tokens + priority hotkeys +
`tod`/`tom` date expansion + in-place sort + `#tag` contexts. The gap is confirmed.

**Reuse stance (user-confirmed): reference only, build clean.** No runtime dependency on any
existing plugin. Two are worth *reading* during implementation:
- `artem98/obsidian_tasks_sort` — already solves the trickiest editor mechanic: detecting the
  contiguous checkbox block under the cursor and rewriting lines in place. Its block-detection
  and line-rewrite approach informs `sort.ts`/`editor.ts` (its emoji-priority logic does not).
- `Prioritize` — its set/remove/increase/decrease command structure validates the v1 command
  design.

**Decided constraints (from brainstorming):**
- **Storage/format:** Markdown checkboxes (`- [ ]`) carrying todo.txt-flavored tokens.
  *Hybrid* — keep a todo.txt look but map tokens so **Tasks/Dataview can still read them**
  where feasible.
- **One deliberate deviation from pure todo.txt:** contexts are Obsidian tags `#tag`, **not**
  `@context`. Projects stay as `+project`. Priority stays as `(A)`. Dates stay as
  `due:YYYY-MM-DD`.
- **Location model:** primary use is **one file per "project" area** (`Work.md`,
  `Personal.md`, …) edited in place; also ad-hoc tasks created in **daily notes**; plus an
  **aggregated cross-file view** (scoped to v1.5 — see below).
- **Platform:** **Desktop-first (Windows).** Format must stay plain-text so Android Obsidian
  can still read/edit, but no mobile-specific UX in v1.
- **Aesthetic:** clean, keyboard-first, **no emojis**, looks like plain text.

## Environment decision: build on **Windows**, not WSL

The vault is mounted on Windows and Obsidian is a Windows Electron app reading a Windows
filesystem — the plugin never touches WSL at runtime. Developing in WSL would force
cross-boundary file I/O (`/mnt/c` or `\\wsl$`), break native file-watch/hot-reload, and add
line-ending friction for zero benefit. The toolchain (Node + TypeScript + esbuild + Obsidian
API) runs natively and identically on Windows. **Conclusion: develop, build, and deploy
entirely on Windows.**

## Task line grammar (the contract)

A task is any Markdown list item that is a checkbox. Canonical token order:

```
- [ ] (A) 2026-09-19 Call the bank about the loan +Finance #calls due:2026-09-25
      ^prio ^creation-date   ^description          ^project ^ctx  ^due
- [x] 2026-09-20 (A) 2026-09-19 Renewed passport +Admin
      ^completion-date, then original priority/creation preserved (todo.txt done convention)
```

- **Priority:** `(A)`–`(Z)` immediately after the checkbox. Absence = no priority.
- **Dates:** ISO `YYYY-MM-DD`. `due:` is the key date field; optionally support `t:`
  (threshold/start). Bare leading date = creation date (todo.txt convention).
- **Projects:** `+Project` (todo.txt-native; Dataview indexes as inline text — acceptable).
- **Contexts:** `#tag` (deviation — Obsidian-native, so tag pane / search / Dataview all work
  for free). This is the one intentional break from todo.txt.
- **Completion:** toggling `- [ ]` → `- [x]` prepends completion date; toggling back removes
  it. Preserve priority as `pri:X` on completion is *optional* — default to keeping `(A)`
  inline for readability (decide during impl; note it here as an open micro-decision).

**Interop note (hybrid mapping):** the checkbox itself is what Tasks/Dataview see as a task.
`due:YYYY-MM-DD` is human-readable and Dataview-queryable as inline text. We are *not* trying
to make the Tasks plugin's emoji date syntax (`📅`) appear — that's the clutter the user is
escaping. Our own commands/views own priority+date logic. `#tag` contexts are natively
indexed. This gives "good-enough" interop without inheriting the emoji UI.

## Architecture (TypeScript community plugin)

Standard Obsidian plugin scaffold (`main.ts`, `manifest.json`, `esbuild.config.mjs`,
`styles.css`, `versions.json`). Suggested module layout:

- `src/main.ts` — plugin entry: register commands, hotkeys, settings tab, (later) view.
- `src/parse.ts` — pure functions: `parseTaskLine(text) → Task | null`,
  `serializeTask(Task) → string`. **Single source of truth for the grammar.** Fully unit-
  testable with no Obsidian dependency.
- `src/priority.ts` — `bumpPriority(task, +1|-1)` cycling `(A)…(Z)`/none.
- `src/dates.ts` — token expansion: `tod`→today, `tom`→tomorrow, `mon`/`tue`/…→next weekday,
  `+3d`/`+1w`→relative. Pure + testable (inject a "today" clock for tests).
- `src/sort.ts` — `sortLines(lines[], comparator)`; default comparator = priority asc, then
  `due` asc, then creation date. Operates on a contiguous list block. **Read
  `artem98/obsidian_tasks_sort` first** for its cursor-block detection (blank line / non-task
  line ends the block) and in-place line-rewrite technique.
- `src/editor.ts` — Obsidian `Editor` glue: find current task line / current list block,
  apply the pure transforms, write back preserving indentation and cursor.
- `src/view.ts` — (v1.5) aggregated `ItemView`.

Keep all logic in the pure modules; keep `main.ts`/`editor.ts` thin. This is what makes the
grammar reliable and the whole thing testable without launching Obsidian.

## v1 scope (ship this first)

Commands (all bound to hotkeys, all operating on the cursor's current line/block):

1. **Increase priority** / **Decrease priority** — `bumpPriority`. On a task with no priority,
   "increase" starts at `(A)` (or a configurable default like `(C)`).
2. **Date shortcut expansion** — an editor command *and* an optional as-you-type trigger:
   typing a token like `tod ` in a `due:` position expands to the ISO date. v1 can start with
   an explicit "expand date token" command to avoid fighting the editor, then add live
   expansion if it feels good. `dates.ts` handles the mapping.
3. **Sort current list** — `sortLines` over the contiguous checkbox block the cursor is in,
   rewritten in place. Setting: also offer "sort whole note".
4. **Toggle done** — prepend/strip completion date (native toggle exists, but ours enforces
   the date convention).

Settings tab: default new-task priority, whether increase-from-none jumps to `(A)`, date
format confirmation (ISO fixed for v1), sort comparator order, list of weekday tokens.

Testing: **Jest/Vitest unit tests** for `parse`, `priority`, `dates`, `sort` — these cover
the grammar contract and are where bugs will actually live.

## v1.5 scope (after v1 is in daily use)

- **Aggregated cross-file view:** an `ItemView` that scans project files + daily notes via the
  vault API, parses each checkbox with `parse.ts`, and renders a sortable/filterable flat
  list (filter by `#context`, `+project`, due window). Clicking a task jumps to its source
  line. This is the "see everything" panel; deferred so v1 ships fast.

## Deployment / dev loop (Windows)

- Symlink or set the build output directory to
  `<vault>/.obsidian/plugins/todotxt-md/` so `npm run dev` (esbuild watch) rebuilds straight
  into the vault.
- Use the community **Hot Reload** dev plugin for instant reload during iteration (works
  natively because everything is on the Windows FS).
- `manifest.json` `isDesktopOnly` can stay `false` (format is plain-text-safe on mobile) but
  we do **not** test/support mobile UX in v1.

## Critical files to create

- `manifest.json`, `package.json`, `esbuild.config.mjs`, `tsconfig.json`, `versions.json`
- `src/main.ts`, `src/parse.ts`, `src/priority.ts`, `src/dates.ts`, `src/sort.ts`,
  `src/editor.ts`
- `styles.css` (minimal — deliberately no decorative styling)
- `tests/parse.test.ts`, `tests/dates.test.ts`, `tests/priority.test.ts`,
  `tests/sort.test.ts`

## Verification (end-to-end)

1. **Unit tests** pass: round-trip `parseTaskLine`↔`serializeTask` on a fixture set covering
   priority, dates, `+project`, `#context`, completion; `dates.ts` token expansion against a
   fixed clock; `sort.ts` ordering; `priority.ts` cycling including the none↔`(A)` edges.
2. **In Obsidian (Windows):** create `Work.md`, add several `- [ ]` tasks. Verify each hotkey:
   priority up/down changes `(A)`↔`(B)`↔none on the cursor line; `tod`/`tom`/weekday tokens
   expand to correct ISO dates; sort command reorders the block by priority→due; toggle-done
   prepends today's completion date.
3. **Interop check:** confirm `#context` tags appear in Obsidian's tag pane, and a simple
   Dataview `TASK` query still lists the tasks (proving we didn't break existing workflows).
4. **Plain-text/Android safety:** open the same file's raw text — confirm it's clean,
   emoji-free, and legible as a portable todo list.

## Open micro-decisions (resolve during implementation, low-stakes)

- On completion, keep `(A)` inline vs. move to `pri:A` (leaning: keep inline for readability).
- Live date-token expansion vs. explicit command first (leaning: command first, then live).
- Default priority when increasing from none (`(A)` vs. `(C)`).
