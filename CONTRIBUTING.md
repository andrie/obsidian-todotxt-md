# Contributing to Todo.txt MD

## Read SPEC.md, DESIGN_RULES.md, and DECISIONS.md first

- `SPEC.md`: what v1 builds, including scope, architecture, verification steps, and the
  competitive landscape this plugin fills a gap in
- `DESIGN_RULES.md`: the durable rules that govern all development beyond v1. Follow them
  throughout. If a rule needs to change, change it explicitly rather than silently violating it
- `DECISIONS.md`: the trade-off log for decisions that reversed or bent a rule after the fact
  (for example, dropping Dataview due-date interop). Check it when something in `SPEC.md` or
  `DESIGN_RULES.md` looks surprising; there's probably a reasoned trade-off behind it

## Non-negotiables

See `DESIGN_RULES.md` for the full set.

- Plain text is the product. Tasks stay legible, editable, and portable as raw Markdown with no
  plugin installed, on desktop and Android. The plugin is a convenience layer, never a container
  format
- No emojis in stored task text, ever: that clutter is the whole reason this exists
- Every action is a hotkey-bindable command
- `src/parse.ts` is the single source of truth for the grammar. Don't write ad-hoc task-syntax
  regex anywhere else; operate on the parsed `Task`, not raw strings
- Keep the core pure and the glue thin. `parse`, `priority`, `dates`, and `sort` import nothing
  from `obsidian` and are unit-tested. Obsidian code (`main.ts`, `editor.ts`, `view.ts`) is a
  thin adapter. Inject a clock; never call `new Date()` in core logic
- Interop with Tasks, Dataview, and Task Genius is best-effort, with no hard dependency on any
  of them

## Grammar cheat-sheet

```
- [ ] (A) 2026-09-19 Call the bank +Finance #calls due:2026-09-25
      prio  creation  description   +project #ctx  due (ISO)
```

- Priority `(A)`-`(Z)`
- Projects `+Project`
- Contexts `#tag`, a deliberate deviation from `todo.txt`'s `@context`
- Dates ISO `YYYY-MM-DD` (`due:`, optional `t:` threshold)
- Human date shortcuts (`tod`, `tom`, weekdays, `+3d`) are input-only: they expand at edit time
  and are never persisted

## Build on Windows, not WSL

The vault and Obsidian are Windows-native, and WSL breaks hot-reload and file-watch. Use
PowerShell as your shell.

The toolchain is Node, TypeScript (strict), esbuild, and the Obsidian API.

Symlink the build output into `<vault>/.obsidian/plugins/todotxt-md/` for hot-reload, and use
the Hot Reload dev plugin. Ask an existing maintainer for a vault path to test against, or use
your own.

## v1 commands

All are hotkey-bindable and operate on the cursor's line or block.

- Increase or decrease priority
- Expand date token
- Sort the current checkbox block in place
- Toggle done, including the completion date
- Aggregated cross-file view

The aggregated view moved into v1 on 2026-09-20 (see `DECISIONS.md`). It replaces Dataview
due-date querying, which turned out to be unreachable without bracketed fields or Tasks-plugin
emoji, and both of those were rejected.

## Development

```bash
npm install
npm run dev      # esbuild watch mode
npm test         # Vitest unit tests
npm run lint      # ESLint + Prettier check
npm run build     # type-check + production build
```

See `SPEC.md` and `DESIGN_RULES.md` for the full grammar contract and architectural rules.

## Definition of done

A change is done when the unit tests are green (parse, priority, dates, sort, including
round-trip and edge cases), you've exercised the behaviour live in Obsidian, and you've checked
the interop guard (`#tag` indexes, and a Dataview `TASK` query still lists tasks). See
`SPEC.md`'s Verification section for the full list.
