# Task 8 Report — SPEC.md and DESIGN_RULES.md Documentation Updates

## Summary

Documentation updates completed for the Token Visual Affordances feature (Tasks 1–7, all complete).

## Changes Made

### 1. SPEC.md — Added visual affordances section

**Location:** Under v1 scope, item 5 (Aggregated view), as a sub-bullet describing display-layer enhancements.

**Content added:**
- Noted that the aggregated view renders `+project` and `#context` as colored, clickable pills with a removable filter-chip bar
- Documented that task lines in the editor receive live syntax highlighting for projects/contexts (per-name hash colors), dates, completion status, and malformed priority detection
- Both features are gated by optional settings, defaulting on, with no grammar changes
- Referenced both design specs as the source of full design detail:
  - `docs/superpowers/specs/2026-10-03-aggregated-view-pills-and-filters-design.md`
  - `docs/superpowers/specs/2026-09-21-in-editor-highlighting-design.md`

### 2. DESIGN_RULES.md §1.2 — Added clarifying note

**Location:** §1.2, "No emojis, ever, in stored task text"

**Reasoning:** While the existing wording in §1.2 is technically clear (it restricts *stored text* and emoji, not optional display coloring), adding a `> changed:` note was warranted to preemptively address the risk that "UI chrome stays visually minimal and text-first" could be misread as prohibiting display-only styling. The note explicitly carves out the feature's design principle: display-only styling (color, underline) applied via CM6 decorations or DOM styling never changes stored text, introduces emoji, or adds chrome chrome — tasks remain byte-identical with the plugin disabled and fully legible as plain text.

## Decisions Made

- **Added clarifying note in DESIGN_RULES.md:** Yes. Decided that even though §1.2's existing language is technically unambiguous, a one-line clarification was worth the small addition to foreclose any plausible misreading. The note follows the project's existing `> changed:` blockquote style for rule amendments.

## Files Changed

- `SPEC.md` — added display-layer enhancements subsection under v1 scope item 5
- `DESIGN_RULES.md` — added `> changed 2026-10-03:` clarification note under §1.2

## Commits

- **d3b5125** — `docs: document project/context visual affordances in SPEC and DESIGN_RULES`

## Status

**DONE**

No concerns. All documentation is in place, consistent with the project's existing tone and style, and commit is clean.
