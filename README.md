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
- Inline field helper: after typing a space on a task line, a menu offers priority, created
  date, `due:`, `t:`, `+project`, `@place` and `#tag`, so you can build a task by tapping (handy
  on mobile). Typing `+` or `@` lists names already used in your tasks, most used first
- In-place sort orders the checkbox block under your cursor by priority, then due date, then
  creation date; also available from the editor's right-click menu
- Three task states: open `- [ ]`, in progress `- [/]` and done `- [x]`. The Cycle status
  command (also in the editor's right-click menu) steps through them and keeps the dates in
  step: entering in progress writes `start:`, entering done writes the completion date (and a
  creation date, if the task has none), and stepping back to open removes the completion date
  and `start:`. Clicking a task's checkbox in the editor does the same, and typing `- [/]`
  stamps `start:` for you
- Create task inserts a new `- [ ]` line already carrying today's creation date
- The aggregated task view lists every task across your vault, or a configured set of folders,
  filterable by due-date window and done state. Each task has a status circle (empty, half or
  full): click it to cycle the status, or click the task to jump to the source line.
  In-progress tasks are listed first
- In the aggregated view, `[[wikilinks]]` render as clickable links, with aliases
  (`[[Note|alias]]`), headings (`[[Note#Heading]]`) and hover preview. Embeds (`![[...]]`) stay
  as text. A link whose text contains `#` or `+`, such as `[[Q3 #plan]]`, is split by the task
  parser first and will not render as a link
- Note-level settings: a note's front matter can leave it out of the aggregated view, or give
  every task in it shared `+project` and `@place` tags (see "Note-level settings")

## Task syntax

```
- [ ] (A) 2026-09-19 Call the bank about the loan +Finance #calls due:2026-09-25
      prio  creation date       description         project  context   due date
```

- Status: `[ ]` open, `[/]` in progress, `[x]` done. `[/]` is not part of `todo.txt` but is a
  common marker in other task systems, and the line stays a valid Markdown checkbox
- Priority: `(A)`-`(Z)`, immediately after the checkbox
- Projects: `+ProjectName`
- Contexts: `#tag` or `@context`, both accepted. `#tag` uses Obsidian-native tags, so the tag
  pane and search work automatically; `@context` is `todo.txt`'s own spelling. Whichever you
  type is preserved exactly
- Dates: ISO `YYYY-MM-DD`. A bare leading date is the creation date (core `todo.txt`); a
  completed task carries its completion date before it. `due:` and `t:` (threshold) use
  `todo.txt`'s own documented `key:value` extension convention. `start:` (when work began)
  follows the same convention, and is not part of `todo.txt` itself

Your tasks stay fully legible, editable, and portable as plain Markdown, with or without this
plugin installed.

## Note-level settings

Add a `todotxt:` property to a note's front matter to control how its tasks appear in the
aggregated view.

```yaml
---
todotxt:
  ignore: true
---
```

Use `ignore: true` for notes such as shopping lists. The note's tasks are left out of the
aggregated view, and its `+project` / `@place` names are left out of the inline suggestions.

```yaml
---
todotxt:
  projects: [Kitchen-reno]
  contexts: [home]
---
```

Every task in this note now counts as `+Kitchen-reno` and `@home` without typing them on each
line. They show muted in the aggregated view and work with its filters and pills. Sigils are
optional: `[Kitchen-reno]`, `["+Kitchen-reno"]` and a single string all work, and a context
without a sigil gets `@` (write `"#home"` to show it as a tag). A tag already typed on the
line is not shown twice.

Obsidian's Properties editor cannot edit the nested `todotxt:` map, so the same three settings
are also available as flat properties you can add from the Properties panel: `todotxt-ignore`
(checkbox), `todotxt-projects` (list) and `todotxt-contexts` (list). Both spellings work, and
if a note has both they combine.

These tags are virtual. They are applied when the view is built and never written into your task
lines, so the plain text stays exactly what you typed.

## Installation

1. Download the latest release
2. Extract `main.js`, `manifest.json`, and `styles.css` into
   `<your-vault>/.obsidian/plugins/todotxt-md/`
3. Enable "Todo.txt MD" in Obsidian's Community Plugins settings

## Settings

- Default priority: the priority assigned when you increase priority from none
- Inline suggestions: master switch for the live popups (date shortcuts, field menu, `+`/`@` lists)
- Field menu on space: show or hide the field menu that appears after a typed space
- Max suggestions: most items shown in the field menu and the `+`/`@` lists
- Scan folders: restrict the aggregated view to specific folders (default: whole vault)
- Default due window: the due-date filter shown when the aggregated view first opens

## Contributing

See `CONTRIBUTING.md` for development setup, architecture notes, and the full grammar and
design contract.

## License

MIT, see `LICENSE`.
