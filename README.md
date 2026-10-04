# Todo.txt MD

A clean, keyboard-driven, emoji-free `todo.txt` layer over Markdown checkboxes in Obsidian.

Create a task anywhere as a normal `- [ ]` checkbox and get `todo.txt` ergonomics: priority
hotkeys, quick date entry, in-place sorting, and an aggregated cross-file task view, without the
emoji clutter of the Tasks or Task Genius plugins.

## No existing plugin combines checkboxes, `todo.txt` tokens, and hotkeys

Obsidian's task-management plugins split into two camps.

Dedicated-file `todo.txt` plugins (`obsidian-todo-txt-mode`, `obsidian-todotxt-plugin`) give you
real `todo.txt` syntax, but only on raw `todo.txt`-style lines in their own files, not on
Markdown checkboxes you can drop into any note. None has priority hotkeys, quick date shortcuts,
or `#tag` contexts.

In-place Markdown-checkbox plugins (Tasks, Task Genius) let you create a task anywhere as a
`- [ ]` checkbox and aggregate them across your vault, but they lean on emoji syntax (🔺⏫📅…)
for priority and dates. That clutters the raw text, which is the opposite of what `todo.txt` is
about.

Todo.txt MD sits between them: a task is a plain checkbox anywhere in your vault, formatted with
classic `todo.txt` tokens (`(A)`, `+Project`, `due:2026-09-25`), driven entirely by hotkeys, and
legible as plain text with or without the plugin installed.

## Features

- Priority hotkeys bump a task's priority (`(A)`-`(Z)`) up or down with a keystroke
- Quick date entry expands `due:tod`, `due:mon`, `due:+3d` to an ISO date (`2026-09-19`) via a
  live suggestion popup, or an explicit "Expand date token" command
- In-place sort orders the checkbox block under your cursor by priority, then due date, then
  creation date; also available from the editor's right-click menu
- Toggle done marks a task complete or incomplete and handles the completion date automatically,
  per the `todo.txt` convention; also available from the editor's right-click menu
- The aggregated task view lists every task across your vault, or a configured set of folders,
  filterable by due-date window and done state. Complete or uncomplete a task directly from the
  list, or click it to jump to the source line

## Task syntax

```
- [ ] (A) 2026-09-19 Call the bank about the loan +Finance #calls due:2026-09-25
      prio  creation date       description         project  context   due date
```

- Priority: `(A)`-`(Z)`, immediately after the checkbox
- Projects: `+ProjectName`
- Contexts: `#tag`, using Obsidian-native tags rather than `todo.txt`'s `@context`, so the tag
  pane and search work automatically
- Dates: ISO `YYYY-MM-DD`. `due:` and `t:` (threshold/start date) use `todo.txt`'s own documented
  `key:value` extension convention

Your tasks stay fully legible, editable, and portable as plain Markdown, with or without this
plugin installed.

## Installation

1. Download the latest release
2. Extract `main.js`, `manifest.json`, and `styles.css` into
   `<your-vault>/.obsidian/plugins/todotxt-md/`
3. Enable "Todo.txt MD" in Obsidian's Community Plugins settings

## Settings

- Default priority: the priority assigned when you increase priority from none
- Date shortcut suggestions: toggle the live popup after typing `due:`/`t:`
- Scan folders: restrict the aggregated view to specific folders (default: whole vault)
- Default due window: the due-date filter shown when the aggregated view first opens

## Contributing

See `CONTRIBUTING.md` for development setup, architecture notes, and the full grammar and
design contract.

## License

MIT, see `LICENSE`.
