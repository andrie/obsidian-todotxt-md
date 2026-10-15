# Note-level tags and ignore — Design

**Date:** 2026-10-15
**Status:** Draft, awaiting review

## Goal

Let a note control how its tasks appear in the aggregated view, via YAML front matter:

- **Ignore:** a note opts out entirely (shopping lists and the like).
- **Inherit:** a note declares `+project` and `@place` tags that apply to every task in it, so the user does
  not retype the same tag on every line.

Both mirror behaviour in the Task Genius plugin. The plain-text rule still holds: task lines are never
rewritten to carry inherited tags.

## Front matter shape

```yaml
todotxt:
  ignore: true
  projects: [project-name]
  contexts: [place-name]
```

- The key is a nested `todotxt:` map. Unquoted `@` cannot start a YAML value, and `ignore=TRUE` is not
  YAML, so a flat `todotxt: +project, @place` form was rejected.
- Sigils are optional. `"+project-name"` and `"@place-name"` (quoted) are accepted because people will
  type them.
- `projects` and `contexts` accept a list or a single string.
- The names `projects` and `contexts` follow todo.txt vocabulary and avoid clashing with Obsidian's own
  `tags:` property, which means `#tags`.

### Parsing rules (`parseNoteMeta`)

| Input | Result |
|---|---|
| no front matter, or `todotxt:` is not a map | empty default (`ignore: false`, no tags) |
| `ignore: true` or `ignore: "true"` (any case) | `ignore: true` |
| any other `ignore` value | `ignore: false` |
| project `"+x"` or `"x"` | project `x` |
| context `"x"` or `"@x"` | `{ name: "x", prefix: "@" }` |
| context `"#x"` | `{ name: "x", prefix: "#" }` |
| YAML number (`projects: [2026]`) | name `"2026"` |
| empty, whitespace-containing or non-scalar entries | dropped silently |
| unparseable YAML | empty default (not ignored) |

A bare context gets `@`, matching todo.txt. An explicit `#` is preserved, as on task lines
(`DECISIONS.md`, 2026-10-03). Names containing whitespace are dropped because `parse.ts` splits tokens
on spaces, so such a name could never match a typed token.

## Design

### Units

| Unit | Kind | Responsibility |
|---|---|---|
| `src/noteMeta.ts` | pure, unit-tested | `splitFrontmatter(content)` returns the YAML block text (or null). `parseNoteMeta(frontmatter: unknown)` returns `NoteMeta`. `readNoteMeta(content, parseYaml)` combines them, with the YAML parser injected so the module imports nothing from `obsidian`. |
| `src/aggregate.ts` | pure, unit-tested | `TaskRecord` gains `inherited`. `aggregateTasks` matches filters against typed plus inherited tags. |
| `src/vocab.ts` | pure, unit-tested | New `extractNoteVocab(meta, lines)`: empty for an ignored note, otherwise the task vocabulary plus the note's inherited names. |
| `src/view.ts` | Obsidian glue | `scanVault` reads front matter, skips ignored files, attaches inherited tags, renders muted pills. |
| `src/vocabIndex.ts` | Obsidian glue | `index()` uses `extractNoteVocab`. |
| `styles.css` | style | `todotxt-md-pill-inherited` muting. |

`parse.ts` is unchanged and remains the only place the task grammar is defined. `noteMeta.ts` handles
front matter, not task syntax, and reuses `ContextToken` from `parse.ts`.

### Reading front matter

Front matter is parsed from the file content that `scanVault` and `VocabIndex` already read, via
Obsidian's `parseYaml`. `metadataCache.getFileCache()` was rejected: it can lag behind a `modify` event,
so a freshly edited `ignore` or tag list would show stale results until the cache caught up.

### Aggregated view

- `TaskRecord.inherited: { projects: string[]; contexts: ContextToken[] }`. Names already typed on the
  task line are removed from `inherited`, so a task never shows the same tag twice. A typed context
  matches an inherited one by name regardless of prefix (filtering is prefix-blind).
- `scanVault`: if `ignore` is set, the file is skipped. Otherwise every record from the file carries the
  file's inherited tags.
- `aggregateTasks`: project filters check `task.projects` plus `inherited.projects`. Context filters check
  `task.contexts` plus `inherited.contexts`, by name. AND semantics are unchanged.
- Rendering: inherited pills use the same colour-by-name as typed ones, with the extra class
  `todotxt-md-pill-inherited` (reduced opacity). Click-to-filter works as for typed pills. With pills
  disabled, inherited tags appear as plain text, as typed tags do.
- Write-back: unchanged. `toggleRecordDone` re-reads the line from disk and re-serialises the parsed
  `Task`. Inherited tags are not on `Task`, so they cannot be written.
- Precedence: `ignore` wins over everything, including the note's tags.
- Refresh: front matter edits are vault `modify` events, so the existing debounced rescan applies.

### Vocabulary index

- An ignored note contributes nothing, so shopping-list names do not appear in the inline suggestions.
- A note's inherited names count as vocabulary (count 1 each, plus typed uses), so `+project-name` can be
  suggested before any task line in the vault uses it.
- The open note's live lines supersede its cached entry (`adjustVocab`). Its live front matter is read
  the same way, so toggling `ignore` takes effect without waiting for autosave.

### Settings

No new settings. The feature is on, and a note opts in by having the key.

## Out of scope

- Folder or glob exclusion lists. Front matter is the per-page tool; globs may follow later.
- A per-task opt-out. A task that does not belong should move to another note.
- Inheriting priority, due dates or any field other than projects and contexts.
- Writing or editing the front matter from the plugin.

## Testing

- `noteMeta.test.ts`: the parsing table above, single string versus list, quoted sigils, mixed case
  `ignore`, malformed YAML values, no front matter, `splitFrontmatter` edge cases (no closing `---`,
  Windows line endings, front matter not at the top).
- `aggregate.test.ts`: filtering by inherited project and context, deduplication against typed tags,
  prefix-blind context match, AND semantics across typed and inherited.
- `vocab.test.ts`: ignored note yields empty vocab, inherited names included, counts.
- Live check in the test vault: an `ignore: true` note is absent from the view and from suggestions;
  a note with `projects` and `contexts` shows muted pills and filters correctly; ticking a task in the
  view leaves the line byte-identical apart from the checkbox and completion date; editing the front
  matter refreshes the view.
- Interop guard (definition of done): `#tag` indexing and the Dataview `TASK` query are unaffected,
  since nothing is written to task lines.

## Documentation

- `README.md`: the YAML shape, with a shopping-list ignore example and a project-note example.
- `SPEC.md`: note-level metadata under the aggregated view.
- `DECISIONS.md`: "Inherited tags are virtual, never persisted", with the rejected `metadataCache` and flat
  `todotxt: +x, @y` alternatives.
