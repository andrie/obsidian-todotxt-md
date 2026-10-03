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
 * Builds the CM6 decoration set for currently-visible lines only (DESIGN_RULES.md section 3.4
 * "operate on the minimal scope") — never the whole document, so cost stays proportional to
 * what's on screen rather than document size.
 */
function buildDecorations(view: EditorView, isEnabled: () => boolean): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	if (!isEnabled()) return builder.finish();

	for (const { from, to } of view.visibleRanges) {
		let pos = from;
		while (pos <= to) {
			const line = view.state.doc.lineAt(pos);
			const lineText = line.text;

			const parsed = parseTaskLineWithSpans(lineText);
			if (parsed) {
				if (parsed.task.done) {
					builder.add(line.from, line.from, Decoration.line({ class: "todotxt-md-hl-done-line" }));
				}
				for (const span of parsed.spans) {
					if (span.kind === "priority") continue; // never colored when valid

					const absFrom = line.from + span.start;
					const absTo = line.from + span.end;
					const className =
						span.kind === "project" || span.kind === "context"
							? null // handled below via inline color, not a shared class
							: KIND_TO_CLASS[span.kind];

					if (span.kind === "project" || span.kind === "context") {
						const name = lineText.slice(span.start, span.end).slice(1); // strip +/#
						builder.add(
							absFrom,
							absTo,
							Decoration.mark({
								attributes: { style: `color: ${nameToColor(name)}` },
							}),
						);
					} else if (className) {
						builder.add(absFrom, absTo, Decoration.mark({ class: className }));
					}
				}

				const prioritySpan = parsed.spans.find((s) => s.kind === "priority");
				if (prioritySpan) {
					const text = lineText.slice(prioritySpan.start, prioritySpan.end);
					if (/[a-z]/.test(text)) {
						builder.add(
							line.from + prioritySpan.start,
							line.from + prioritySpan.end,
							Decoration.mark({ class: "todotxt-md-hl-priority-lowercase" }),
						);
					}
				}
			}

			const malformed = detectMalformedPriority(lineText);
			if (malformed) {
				builder.add(
					line.from + malformed.start,
					line.from + malformed.end,
					Decoration.mark({ class: "todotxt-md-hl-priority-malformed" }),
				);
			}

			pos = line.to + 1;
		}
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
