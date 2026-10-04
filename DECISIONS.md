# todotxt-md — Decision Log

> Records decisions that reverse or materially bend a rule in `SPEC.md` or `DESIGN_RULES.md`,
> along with the trade-off that drove them. `SPEC.md`/`DESIGN_RULES.md` reflect the *current*
> state; this file explains *why* it changed. Newest entries first.

---

## 2026-10-03 — Partial reversal: accept `@context` alongside `#tag`, prefix preserved per-token

### Context

The 2026-09-20 decision (see entry below) replaced todo.txt's standard `@context` with
Obsidian-native `#tag` as a one-for-one substitution, specifically for free tag-pane/search
indexing. Manually testing the token-visual-affordances feature (colored pills, click-to-filter)
in a real vault surfaced that this substitution left `@place`-style tokens with no color/pill/
filter support at all, and the user flagged that forcing a single spelling discards real value
from the todo.txt spec — specifically, compatibility with other todo.txt tools when moving tasks
between them.

### Decision

**Both `@context` and `#context` are now accepted as first-class, equally valid spellings of the
same underlying concept.** `Task.contexts` changes from `string[]` to `ContextToken[]`
(`{ name: string; prefix: "@" | "#" }`), so each token's original prefix is preserved exactly on
every rewrite — no canonicalization, no settings-driven default. Color and filter identity
(`nameToColor`, click-to-filter, the aggregated view's filter-chip bar) are keyed on the bare
`name` only, prefix-blind: `@home` and `#home` render the identical color and populate the same
filter entry, since they represent the same real-world context under two different spellings.

### Why this doesn't reverse the whole 2026-09-20 decision

This is a **partial** reversal, scoped strictly to the context-token spelling question. The
`due:`/Dataview-interop stance, the aggregated view's role as the native due-date query mechanism,
and the emoji-rejection principle from that decision all stand unchanged — see the 2026-09-20
entry below for that reasoning, which this entry does not revisit.

### Costs / trade-offs accepted

- A user who writes `@home` instead of `#home` knowingly forgoes Obsidian's native tag-pane/search
  indexing for that specific token — `#` is Obsidian's real tag syntax, `@` is not, and no
  amount of plugin-side color/filter support substitutes for that platform-level integration.
  This is treated as an accepted, informed trade-off (the user's explicit choice), not something
  the plugin tries to mitigate via a warning or nudge.
- `Task.contexts`'s type changed from `string[]` to `ContextToken[]`, a breaking change to the
  parser's own output shape — every consumer (`aggregate.ts`'s filter matching, `view.ts`'s pill
  rendering, every fixture in `tests/fixtures/tasks.ts`) needed updating in lockstep. No consumer
  outside this project's own codebase is known to depend on the old shape (no public API surface
  beyond this plugin's own `main.js` bundle), so this was judged an acceptable one-time cost.

### Reversibility

If this proves to add more parsing/type complexity than value in practice (e.g. users
overwhelmingly prefer one spelling and never use the other), the simplest rollback is **not**
re-removing `@` recognition — that would silently break any task already using `@context`, which
DESIGN_RULES.md explicitly treats as the thing to avoid. Instead, a future decision could add a
one-time, explicitly user-invoked "canonicalize all contexts to `#`" command, leaving the dual
parse-time recognition in place permanently (parsing leniency costs nothing; serialization
defaults can still change).

---

## 2026-09-21 — Correction: rioskit/obsidian-todo-txt-mode is not file-extension-restricted

### Context

`SPEC.md`'s competitive-landscape section (written 2026-09-19) claimed
`rioskit/obsidian-todo-txt-mode` and `mvgrimes/obsidian-todotxt-plugin` "operate only on
dedicated `.todotxt` files, not Markdown checkboxes in normal notes." The user flagged this
plugin as a possible gap in the original research and asked for a careful re-check against the
actual repo, rather than accepting either the original claim or the concern at face value.

### What was actually verified (2026-09-21)

Reading `rioskit/obsidian-todo-txt-mode`'s source directly (`src/main.ts`) shows it targets
files via `isTodoTxtFile()`, which checks whether a file's **path** matches
`settings.todoFilePaths` or `settings.doneFilePath` — a user-configured path list, not a file
*extension* check. So the plugin is not restricted to `.txt`/`.todotxt` files; a user could
point it at a Markdown note and get its syntax highlighting, auto-completion-date, and
recurring-task features there.

However, re-reading `src/syntax.ts` and `src/task-watcher.ts` confirms what it actually
highlights/watches: raw todo.txt-formatted lines (`x 2023-05-08 task ...`, `(A) task ...`)
typed directly in the file — not Markdown checkbox list items (`- [ ]`). It has no concept of a
checkbox at all. It also confirmed to have no priority-bump hotkeys, no `tod`/`tom` date-entry
shortcuts, and `@context` (not `#tag`).

### Correction

The "operates only on dedicated `.todotxt` files" claim in `SPEC.md` was imprecise and has been
corrected to describe the actual mechanism (path-based file targeting, not extension-based) and
the actual distinguishing gap (no Markdown-checkbox support, not a file-type restriction).

### Why this doesn't change the project's conclusion

The core "no plugin combines Markdown checkboxes + emoji-free todo.txt tokens + priority
hotkeys + date expansion + in-place sort + `#tag` contexts" conclusion in `SPEC.md` still holds
— `rioskit/obsidian-todo-txt-mode` still has none of priority hotkeys, date shortcuts, or
checkbox-based task creation, regardless of which files it can be pointed at. The correction is
about precision in *why* the gap exists (checkbox support, not file extension), not about
whether the gap exists.

---

## 2026-09-20 — Correction: `due:` is not "pure todo.txt" — it's the spec's own extension example

### Context

The entry immediately below this one (and earlier drafts of `SPEC.md`) describe `due:YYYY-MM-DD`
as "todo.txt-native" or imply it sits alongside priority/`+project` as core grammar. Checked
directly against the official spec (github.com/todotxt/todo.txt) after being challenged on this
claim: the core format defines only priority `(A)`-`(Z)`, creation date, completion date,
`+project`, `@context`. There is no native due-date field. The spec separately defines a generic
`key:value` **extension mechanism** for tool developers — and its own worked example in the spec
text is literally `due:2010-01-02`.

### Correction

`due:` is not core todo.txt grammar, but it is also not an invented deviation — it is the spec's
own documented example of its own extension mechanism, used exactly as illustrated, and it is a
widely-adopted ecosystem convention on top of that (todo.txt-cli add-ons, SwiftoDo, and others
use the same `due:` key). `SPEC.md`'s decisions table and grammar section have been corrected
(2026-09-20) to state this precisely instead of calling it "pure todo.txt." `t:` (threshold)
rests on the same `key:value` mechanism.

### Why this matters here

None of the *decisions* below change as a result — the Dataview-interop trade-off, the
aggregated-view scope pull-forward, and the emoji-rejection all stand regardless of whether
`due:` is core spec or the spec's own extension example. This entry exists purely to correct a
factual overstatement in the project's own documentation before it propagated further (e.g. into
this file's Option 1/3 descriptions below, which use "todo.txt-native" loosely — read those in
light of this correction rather than as a further claim about spec provenance).

---

## 2026-09-20 — Drop Dataview due-date interop; build the aggregated view natively, pulled into v1

### Context

`SPEC.md`'s original decisions table claimed `due:YYYY-MM-DD` (bare, single colon, no
brackets) would be "Dataview-queryable." Manual verification in a real vault (Obsidian +
Dataview installed) proved this false: Dataview only recognizes inline fields written as
`[key:: value]` (bracketed, double colon), or a small hardcoded set of Tasks-plugin emoji
(📅/📆/🗓️ for due dates specifically — confirmed by reading Dataview's own source,
`data-import/inline-field.ts`). A bare `due:2026-09-25` token is invisible to Dataview's query
engine; it only ever showed up as literal text in a plain `TASK` listing, never in a
field-filtered `WHERE due <= date(...)` query.

### Options considered

1. **Switch `due:` to bracketed Dataview syntax** (`[due:: 2026-09-25]`) — makes due dates
   genuinely queryable, but adds visual noise (`[`, `::`) that the todo.txt-native bare syntax
   was specifically designed to avoid.
2. **Adopt the Tasks-plugin due-date emoji (📅)** — the only emoji-compatible path Dataview
   supports automatically, with no settings toggle required. Directly contradicts
   `DESIGN_RULES.md` §1.2 ("No emojis, ever, in stored task text") — the project's founding
   differentiator versus the Tasks plugin is specifically *not* using this emoji.
3. **Keep bare `due:`, drop the Dataview-queryable claim, accept a capability gap** — preserves
   the grammar exactly as designed, but leaves the user with no way to query/filter tasks by
   due date across files until some future feature fills the gap.
4. **Drop Dataview interop for dates entirely; build native filter/sort into the plugin** — the
   option chosen. See below.

### Decision

**Chosen: Option 4.** Dataview due-date querying is dropped as a goal. The bare `due:YYYY-MM-DD`
grammar is unchanged — no brackets, no emoji, no compromise to the grammar contract. In its
place, the aggregated cross-file view (previously deferred to v1.5) is **pulled into v1** and
built with its own native filter/sort UI (by `#context`, `+project`, due window), so the actual
underlying need — "let me see and query my tasks across files" — is met without depending on
Dataview's field-parsing quirks at all.

### Why this beats the alternatives

- It resolves the tension by **removing the dependency**, not by bending the grammar to fit
  someone else's parser. The whole reason this plugin exists is to not be at the mercy of
  another plugin's UI/syntax conventions (see `SPEC.md`'s competitive-landscape section) — this
  keeps that principle intact for a currency (Dataview's inline-field syntax) that turned out to
  be a bigger constraint than expected.
- A plugin-owned view can filter/sort/render exactly how this project wants — no visual clutter
  from bracket syntax, no reliance on Dataview being installed at all (it was only ever
  "best-effort," per `DESIGN_RULES.md` §3.5).
- It converts a workaround (emoji, brackets) into a feature (a first-class aggregated view),
  which is more valuable long-term than either compromise.

### Costs / trade-offs accepted

- **v1 is now bigger.** The aggregated `ItemView` (vault scan, per-file parsing, sortable/
  filterable rendering, jump-to-source) is real editor/view-layer work that v1 previously
  deferred specifically to keep scope small (`DESIGN_RULES.md` §6.1, "ship v1 before v1.5").
  This decision explicitly overrides that scope boundary for the view — see the corresponding
  edit to `SPEC.md`'s v1 scope section.
- **Dataview interop is now explicitly out of scope for dates.** The interop verification step
  in `SPEC.md` (tag-pane + Dataview `TASK` query) still holds for `#context` tags and basic task
  listing — those are unaffected, since tag indexing is native Obsidian behavior, not a Dataview
  field feature. But the due-date field-query verification step is removed; Dataview will never
  see `due:` as a filterable field under this design, by choice.
- **No emoji compromise was needed** — worth noting explicitly since it was the live alternative
  on the table. `DESIGN_RULES.md` §1.2 remains untouched and fully intact.

### Reversibility

If a future need re-emerges for Dataview interop specifically (e.g. a user wants their
existing Dataview dashboards to keep working), the bracket-syntax option (Option 1 above) is
still available without touching this decision — it would be an additive parser change
(`parseTaskLine` already needs to be lenient; recognizing `[due:: ...]` as an alternate spelling
of the same field is a small, backward-compatible addition), not a reversal of this one.
