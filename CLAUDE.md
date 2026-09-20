# CLAUDE.md — todotxt-md

Obsidian community plugin: a **clean, keyboard-driven, emoji-free todo.txt layer over Markdown
checkboxes**. Create a task as a normal `- [ ]` checkbox in any note; get todo.txt ergonomics
(priority hotkeys, quick dates, in-place sort) without the emoji clutter of the Tasks / Task
Genius plugins.

## Read these first

- **`PLAN.md`** — what to build (v1 scope, architecture, verification). Start here on a fresh
  session.
- **`DESIGN_RULES.md`** — the durable rules that govern *all* development beyond v1. Follow
  throughout; don't silently violate — change the rule explicitly if it must change.
- **`DECISIONS.md`** — trade-off log for decisions that reversed or bent a rule after the fact
  (e.g. dropping Dataview due-date interop). Check it when something in `PLAN.md`/
  `DESIGN_RULES.md` looks surprising — there's probably a reasoned trade-off behind it.

## Non-negotiables (see DESIGN_RULES.md for the full set)

- **Plain text is the product.** Tasks stay legible/editable/portable as raw Markdown with no
  plugin installed, on desktop *and* Android. The plugin is a convenience layer, never a
  container format.
- **No emojis in stored task text — ever.** That clutter is the whole reason this exists.
- **Keyboard-first.** Every action is a hotkey-bindable command.
- **`src/parse.ts` is the single source of truth for the grammar.** No ad-hoc task-syntax
  regex anywhere else. Operate on the parsed `Task`, not raw strings.
- **Pure core, thin glue.** `parse` / `priority` / `dates` / `sort` import nothing from
  `obsidian` and are unit-tested; Obsidian code (`main.ts`, `editor.ts`, `view.ts`) is a thin
  adapter. Inject a clock — never call `new Date()` in core logic.
- **Best-effort interop, no hard dependency** on Tasks / Dataview / Task Genius.

## Grammar cheat-sheet

```
- [ ] (A) 2026-09-19 Call the bank +Finance #calls due:2026-09-25
      prio  creation  description   +project #ctx  due (ISO)
```

- Priority `(A)`–`(Z)`; Projects `+Project`; **Contexts `#tag`** (deliberate deviation from
  todo.txt `@context`); Dates ISO `YYYY-MM-DD` (`due:`, optional `t:` threshold).
- Human date shortcuts (`tod`, `tom`, weekdays, `+3d`) are input-only, expanded at edit time,
  **never persisted**.

## Environment & dev loop

- **Build on Windows, not WSL** (vault + Obsidian are Windows-native; WSL breaks
  hot-reload/file-watch). Shell: PowerShell.
- Toolchain: Node + TypeScript (strict) + esbuild + Obsidian API.
- Symlink build output into `<vault>/.obsidian/plugins/todotxt-md/` for hot-reload; use the
  **Hot Reload** dev plugin. **Ask the user for the vault path** — it isn't recorded in-repo.

## v1 commands (all hotkey-bindable, operate on cursor line/block)

Increase/decrease priority · expand date token · sort current checkbox block in place · toggle
done (with completion date) · **aggregated cross-file view** (moved into v1 on 2026-09-20 —
see `DECISIONS.md` — it replaces Dataview due-date querying, which was investigated and
confirmed unreachable without bracketed fields or Tasks-plugin emoji, both rejected).

## Definition of done

Unit tests green (parse/priority/dates/sort, incl. round-trip and edge cases) **and** behavior
exercised live in Obsidian **and** interop guard checked (`#tag` indexes, Dataview `TASK`
query still lists tasks). See `PLAN.md` → Verification.
