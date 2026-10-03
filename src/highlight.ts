/**
 * CM6 decoration extension coloring task-line tokens in Live Preview/Source mode. First CM6
 * extension in this codebase (DESIGN_RULES.md "pure core, thin glue" applies: all parsing
 * logic lives in parse.ts/tokenColors.ts; this file is Obsidian/CM6 adapter code, manually
 * verified rather than unit-tested, matching the posture of view.ts/dateSuggest.ts).
 *
 * Import note: dateSuggest.ts imports CM6-adjacent Obsidian types (EditorSuggest etc.) from
 * "obsidian" directly, but that convention doesn't extend here — obsidian.d.ts does not
 * re-export the general decoration/view-plugin symbols we need (Decoration, DecorationSet,
 * ViewPlugin, ViewUpdate, RangeSetBuilder, Extension), only one concrete ViewPlugin instance
 * (livePreviewState). Those symbols come from @codemirror/view and @codemirror/state, which
 * ARE resolvable here because the installed "obsidian" package declares them as exact-pinned
 * peerDependencies (so npm installs them into node_modules even though this project's
 * package.json doesn't list them directly). @codemirror/language is NOT installed — nothing in
 * the dependency tree needs it — and it's also unused by this file (no syntaxTree lookups are
 * needed: all token boundaries come from parseTaskLineWithSpans/detectMalformedPriority), so
 * that import is omitted entirely rather than added as a new direct dependency.
 */
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";
import { parseTaskLineWithSpans, detectMalformedPriority, type TokenSpan } from "./parse";
import { nameToColor } from "./tokenColors";

const KIND_TO_CLASS: Partial<Record<TokenSpan["kind"], string>> = {
	creationDate: "todotxt-md-hl-date",
	due: "todotxt-md-hl-date",
	threshold: "todotxt-md-hl-date",
};

/**
 * One decoration to be inserted into the RangeSetBuilder, pending position-sort. `from`/`to`
 * are document-absolute offsets (already folded in with the owning line's `line.from`).
 * `isLine` marks a Decoration.line (vs. Decoration.mark) so ties at the same `from` can put the
 * line decoration first — RangeSetBuilder.add requires non-decreasing `from`/`startSide` order,
 * and line decorations conventionally sort before marks at an identical position.
 */
export interface PendingDecoration {
	from: number;
	to: number;
	decoration: Decoration;
	isLine: boolean;
}

/**
 * Computes every decoration for a single line, position-unsorted (callers must sort by `from`
 * before handing these to RangeSetBuilder.add — see buildDecorations). Pure function of the
 * line's text and its document-absolute start offset: no EditorView/CM6 state involved, so this
 * is unit-testable directly (see tests/highlight.test.ts) despite the rest of this file being
 * manually-verified adapter code. Extracted specifically so the ordering invariant (every
 * caller must sort before building) can be regression-tested without a live view.
 */
export function computeLineDecorations(lineText: string, lineFrom: number): PendingDecoration[] {
	const pending: PendingDecoration[] = [];

	const parsed = parseTaskLineWithSpans(lineText);
	if (parsed) {
		if (parsed.task.done) {
			pending.push({
				from: lineFrom,
				to: lineFrom,
				decoration: Decoration.line({ class: "todotxt-md-hl-done-line" }),
				isLine: true,
			});
		}
		for (const span of parsed.spans) {
			if (span.kind === "priority") continue; // never colored when valid

			const absFrom = lineFrom + span.start;
			const absTo = lineFrom + span.end;

			if (span.kind === "project" || span.kind === "context") {
				const name = lineText.slice(span.start, span.end).slice(1); // strip +/#
				pending.push({
					from: absFrom,
					to: absTo,
					decoration: Decoration.mark({
						attributes: { style: `color: ${nameToColor(name)}` },
					}),
					isLine: false,
				});
			} else {
				const className = KIND_TO_CLASS[span.kind];
				if (className) {
					pending.push({
						from: absFrom,
						to: absTo,
						decoration: Decoration.mark({ class: className }),
						isLine: false,
					});
				}
			}
		}

		const prioritySpan = parsed.spans.find((s) => s.kind === "priority");
		if (prioritySpan) {
			const text = lineText.slice(prioritySpan.start, prioritySpan.end);
			if (/[a-z]/.test(text)) {
				pending.push({
					from: lineFrom + prioritySpan.start,
					to: lineFrom + prioritySpan.end,
					decoration: Decoration.mark({ class: "todotxt-md-hl-priority-lowercase" }),
					isLine: false,
				});
			}
		}
	}

	const malformed = detectMalformedPriority(lineText);
	if (malformed) {
		pending.push({
			from: lineFrom + malformed.start,
			to: lineFrom + malformed.end,
			decoration: Decoration.mark({ class: "todotxt-md-hl-priority-malformed" }),
			isLine: false,
		});
	}

	return pending;
}

/**
 * Builds the CM6 decoration set for currently-visible lines only (DESIGN_RULES.md section 3.4
 * "operate on the minimal scope") — never the whole document, so cost stays proportional to
 * what's on screen rather than document size.
 *
 * Per-line token detection (computeLineDecorations) runs in several logically-independent
 * passes — the main span loop, then a separate lowercase-priority check, then a separate
 * malformed-priority check — so decorations are NOT discovered in left-to-right position order
 * within a line (e.g. a lowercase "(a)" at the start of a line is detected after a +project
 * later in the line). RangeSetBuilder.add requires calls in non-decreasing `from` order and
 * throws otherwise, so every decoration across all visible lines is collected first and sorted
 * by position before any builder.add call happens.
 */
function buildDecorations(view: EditorView, isEnabled: () => boolean): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	if (!isEnabled()) return builder.finish();

	const pending: PendingDecoration[] = [];

	for (const { from, to } of view.visibleRanges) {
		let pos = from;
		while (pos <= to) {
			const line = view.state.doc.lineAt(pos);
			pending.push(...computeLineDecorations(line.text, line.from));
			pos = line.to + 1;
		}
	}

	pending.sort((a, b) => a.from - b.from || (a.isLine === b.isLine ? 0 : a.isLine ? -1 : 1));

	for (const { from, to, decoration } of pending) {
		builder.add(from, to, decoration);
	}

	return builder.finish();
}

/**
 * CM6 extension coloring task-line tokens in Live Preview/Source mode. Decorations stay
 * visible while the cursor is inside them (unlike markup-concealment behavior) since they
 * color semantic categories, not syntax markup — concealing them while editing would remove
 * the scanning benefit the feature exists for. Inert in Reading mode, which doesn't use CM6.
 */
export function buildHighlightExtension(isEnabled: () => boolean): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildDecorations(view, isEnabled);
			}

			update(update: ViewUpdate): void {
				if (update.docChanged || update.viewportChanged || update.selectionSet) {
					this.decorations = buildDecorations(update.view, isEnabled);
				}
			}
		},
		{
			decorations: (plugin) => plugin.decorations,
		},
	);
}
