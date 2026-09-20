# todotxt-md — Decision Log

> Records decisions that reverse or materially bend a rule in `PLAN.md` or `DESIGN_RULES.md`,
> along with the trade-off that drove them. `PLAN.md`/`DESIGN_RULES.md` reflect the *current*
> state; this file explains *why* it changed. Newest entries first.

---

## 2026-09-20 — Drop Dataview due-date interop; build the aggregated view natively, pulled into v1

### Context

`PLAN.md`'s original decisions table claimed `due:YYYY-MM-DD` (bare, single colon, no
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
  another plugin's UI/syntax conventions (see `PLAN.md`'s competitive-landscape section) — this
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
  edit to `PLAN.md`'s v1 scope section.
- **Dataview interop is now explicitly out of scope for dates.** The interop verification step
  in `PLAN.md` (tag-pane + Dataview `TASK` query) still holds for `#context` tags and basic task
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
