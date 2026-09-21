# Todo.txt MD

A clean, keyboard-driven, emoji-free todo.txt layer over Markdown checkboxes in Obsidian.

Create a task anywhere as a normal `- [ ]` checkbox and get todo.txt ergonomics — priority
hotkeys, quick date entry, in-place sorting, an aggregated cross-file task view — without the
emoji clutter of the Tasks or Task Genius plugins.

## Features

- **Priority hotkeys** — bump a task's priority (`(A)`-`(Z)`) up or down with a keystroke.
- **Quick date entry** — type `due:tod`, `due:mon`, `due:+3d` and get a live suggestion popup
  that expands it to an ISO date (`2026-09-19`); an explicit "Expand date token" command is also
  available.
- **In-place sort** — sort the checkbox block under your cursor by priority, then due date, then
  creation date.
- **Toggle done** — mark a task complete (or back to incomplete), with the completion date
  handled automatically per the todo.txt convention.
- **Aggregated task view** — a sortable, filterable list of every task across your vault
  (or a configured set of folders), filterable by due-date window and done state, with a
  checkbox to complete/uncomplete tasks directly from the list and click-to-jump to the source
  line.

## Task syntax

```
- [ ] (A) 2026-09-19 Call the bank about the loan +Finance #calls due:2026-09-25
      prio  creation date       description         project  context   due date
```

- Priority: `(A)`-`(Z)`, immediately after the checkbox.
- Projects: `+ProjectName`.
- Contexts: `#tag` (uses Obsidian-native tags, rather than todo.txt's `@context`, so the tag
  pane and search work automatically).
- Dates: ISO `YYYY-MM-DD`. `due:` and `t:` (threshold/start date) use todo.txt's own documented
  `key:value` extension convention.

Tasks remain fully legible, editable, and portable as plain Markdown — with or without this
plugin installed.

## Installation

1. Download the latest release.
2. Extract `main.js`, `manifest.json`, and `styles.css` into
   `<your-vault>/.obsidian/plugins/todotxt-md/`.
3. Enable "Todo.txt MD" in Obsidian's Community Plugins settings.

## Settings

- **Default priority** — priority assigned when increasing priority from none.
- **Date shortcut suggestions** — toggle the live popup after typing `due:`/`t:`.
- **Scan folders** — restrict the aggregated view to specific folders (default: whole vault).
- **Default due window** — the due-date filter shown when the aggregated view first opens.

## Development

```bash
npm install
npm run dev      # esbuild watch mode
npm test         # Vitest unit tests
npm run lint      # ESLint + Prettier check
npm run build     # type-check + production build
```

See `SPEC.md` and `DESIGN_RULES.md` in this repository for the full grammar contract and
architectural rules.

## License

MIT — see `LICENSE`.
