import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	Notice,
	TFile,
} from "obsidian";
import { detectTrigger, TypedSpaceTracker, type TriggerMatch } from "./triggers";
import { suggestDateShortcuts, type DateShortcutSuggestion, type Clock } from "./dates";
import {
	suggestFields,
	planFieldEdit,
	planPriorityEdit,
	planReplace,
	editsDescending,
	type EditPlan,
	type FieldSuggestion,
} from "./suggestFields";
import { rankVocab, type VocabEntry } from "./vocab";
import type { VocabIndex } from "./vocabIndex";

export type TaskSuggestion =
	| { type: "date"; item: DateShortcutSuggestion }
	| { type: "field"; item: FieldSuggestion }
	| { type: "vocab"; prefix: "+" | "@"; item: VocabEntry }
	| { type: "priority"; letter: string };

export interface TaskSuggestOptions {
	enabled: boolean;
	fieldMenu: boolean;
	maxItems: number;
}

const PRIORITY_LETTERS = ["A", "B", "C", "D", "E"];

/**
 * The single inline popup for checkbox lines: date shortcuts after due:/t:/leading ":", a field
 * menu after a space, +project / @place completion, and the "!" priority sub-list
 * (DESIGN_RULES.md section 1.4 "assist, don't nag"; one EditorSuggest only — two registered
 * suggests compete for the same keystroke). All decisions come from the pure triggers.ts /
 * suggestFields.ts / vocab.ts; this class only wires them to Obsidian. "#" is deliberately not
 * handled: Obsidian's native tag popup owns it.
 */
export class TaskFieldSuggest extends EditorSuggest<TaskSuggestion> {
	private options: TaskSuggestOptions = { enabled: true, fieldMenu: true, maxItems: 10 };
	/** The field menu opens only right after a space the user typed (see TypedSpaceTracker). */
	private readonly typedSpace = new TypedSpaceTracker();
	private dbgPrev = ""; // DEBUG-TEMP

	constructor(
		app: App,
		private readonly clock: Clock,
		private readonly vocab: VocabIndex,
	) {
		super(app);
	}

	configure(options: Partial<TaskSuggestOptions>): void {
		this.options = { ...this.options, ...options };
	}

	private matchAt(lineNo: number, line: string, ch: number): TriggerMatch | null {
		return detectTrigger(line, ch, {
			fieldMenu: this.options.fieldMenu && this.typedSpace.isTyped(lineNo, line, ch),
		});
	}

	private currentMatch(editor: Editor): TriggerMatch | null {
		const cursor = editor.getCursor();
		return this.matchAt(cursor.line, editor.getLine(cursor.line), cursor.ch);
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		_file: TFile | null,
	): EditorSuggestTriggerInfo | null {
		const line = editor.getLine(cursor.line);
		// Observe before any early return so the tracker always sees the previous line state.
		// DEBUG-TEMP
		if (line.slice(0, cursor.ch).endsWith(" ")) {
			new Notice(
				`prev=${JSON.stringify(this.dbgPrev)} now=${JSON.stringify(line)} ch=${cursor.ch}`,
				8000,
			);
		}
		this.dbgPrev = line;
		this.typedSpace.observe(cursor.line, line, cursor.ch, editor.lineCount());
		if (!this.options.enabled) return null;
		const match = this.matchAt(cursor.line, line, cursor.ch);
		if (!match) return null;
		return {
			start: { line: cursor.line, ch: match.start },
			end: { line: cursor.line, ch: match.end },
			query: match.query,
		};
	}

	async getSuggestions(context: EditorSuggestContext): Promise<TaskSuggestion[]> {
		const match = this.currentMatch(context.editor);
		if (!match) return [];
		const max = this.options.maxItems;

		switch (match.kind) {
			case "date":
				return suggestDateShortcuts(match.query, this.clock).map((item): TaskSuggestion => ({
					type: "date",
					item,
				}));
			case "field": {
				const line = context.editor.getLine(context.editor.getCursor().line);
				return suggestFields(line, this.clock)
					.slice(0, max)
					.map((item): TaskSuggestion => ({ type: "field", item }));
			}
			case "priority": {
				const lower = match.query.toLowerCase();
				return PRIORITY_LETTERS.filter((letter) => letter.toLowerCase().startsWith(lower)).map(
					(letter): TaskSuggestion => ({ type: "priority", letter }),
				);
			}
			case "project":
			case "at": {
				// Live editor text minus the line being typed replaces the open note's autosave-lagged
				// cache entry, so the user's own half-typed token is never offered back.
				const lines = context.editor.getValue().split("\n");
				lines[context.editor.getCursor().line] = "";
				const vocab = await this.vocab.get(
					context.file ? { path: context.file.path, lines } : undefined,
				);
				const counts = match.kind === "project" ? vocab.project : vocab.at;
				const prefix = match.kind === "project" ? "+" : "@";
				return rankVocab(counts, match.query, max).map((item): TaskSuggestion => ({
					type: "vocab",
					prefix,
					item,
				}));
			}
		}
	}

	renderSuggestion(value: TaskSuggestion, el: HTMLElement): void {
		switch (value.type) {
			case "date":
				el.addClass("todotxt-md-date-suggestion");
				el.createSpan({ text: value.item.token, cls: "todotxt-md-date-suggestion-token" });
				if (value.item.iso) {
					el.createSpan({
						text: ` -> ${value.item.iso}`,
						cls: "todotxt-md-date-suggestion-date",
					});
				}
				el.createSpan({
					text: ` (${value.item.label})`,
					cls: "todotxt-md-date-suggestion-label",
				});
				return;
			case "field":
				el.createSpan({ text: value.item.label, cls: "todotxt-md-field-suggestion-label" });
				if (value.item.hint) {
					el.createSpan({
						text: `  ${value.item.hint}`,
						cls: "todotxt-md-suggestion-muted",
					});
				}
				return;
			case "vocab":
				el.createSpan({
					text: `${value.prefix}${value.item.name}`,
					cls: "todotxt-md-field-suggestion-label",
				});
				el.createSpan({
					text: `  ${value.item.count}`,
					cls: "todotxt-md-suggestion-muted",
				});
				return;
			case "priority":
				el.createSpan({
					text: `(${value.letter})`,
					cls: "todotxt-md-field-suggestion-label",
				});
				return;
		}
	}

	selectSuggestion(value: TaskSuggestion, _evt: MouseEvent | KeyboardEvent): void {
		const context = this.context;
		if (!context) return;
		const editor = context.editor;
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		const match = this.currentMatch(editor);
		if (!match) return;

		let plan: EditPlan | null = null;
		switch (value.type) {
			case "date":
				if (value.item.iso) plan = planReplace(match, value.item.iso);
				break;
			case "vocab":
				plan = planReplace(match, `${value.prefix}${value.item.name} `);
				break;
			case "priority":
				plan = planPriorityEdit(line, match, value.letter);
				break;
			case "field":
				plan = planFieldEdit(line, cursor.ch, value.item.kind, this.clock);
				break;
		}
		if (!plan) return;

		for (const edit of editsDescending(plan)) {
			editor.replaceRange(
				edit.insert,
				{ line: cursor.line, ch: edit.from },
				{ line: cursor.line, ch: edit.to },
			);
		}
		editor.setCursor({ line: cursor.line, ch: plan.cursor });
	}
}
