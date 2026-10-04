import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	TFile,
} from "obsidian";
import { parseTaskLine, checkboxBodyStart } from "./parse";
import { suggestDateShortcuts, type DateShortcutSuggestion, type Clock } from "./dates";

const TRIGGER_RE = /(?:^|\s)(?:due|t):([A-Za-z0-9+]*)$/;

/**
 * Leading-position trigger: a bare ":" immediately after the checkbox, or immediately after
 * a priority token, with nothing else before it. Unlike TRIGGER_RE, this is anchored to the
 * start of the body (not "anywhere preceded by whitespace") because a bare ":" has no
 * grammar meaning anywhere else — it's pure trigger syntax, never persisted (see
 * SPEC.md "Editor mechanics" boundary-condition lesson re: due:/t:). Which Task field this
 * conceptually fills (creationDate vs. completionDate) is decided solely by task.done, not by
 * cursor position — a done task's ":" always means completion date.
 */
const LEADING_DATE_TRIGGER_RE = /^(?:\([A-Za-z]\)\s+)?:([A-Za-z0-9+]*)$/;

/**
 * Live date-shortcut popup. Triggers immediately after "due:"/"t:" anywhere on a checkbox
 * line, or after a bare leading ":" (right after the checkbox or after a priority token) —
 * (DESIGN_RULES.md section 1.4 "assist, don't nag") — never on generic prose, even prose
 * starting with a date-shortcut-looking word. Additive to the explicit "Expand date token"
 * command in editor.ts; both call into the same dates.ts core.
 */
export class DateShortcutSuggest extends EditorSuggest<DateShortcutSuggestion> {
	private enabled = true;

	constructor(
		app: App,
		private readonly clock: Clock,
	) {
		super(app);
	}

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		_file: TFile | null,
	): EditorSuggestTriggerInfo | null {
		if (!this.enabled) return null;

		const line = editor.getLine(cursor.line);
		if (!parseTaskLine(line)) return null;

		const beforeCursor = line.slice(0, cursor.ch);

		const bodyStart = checkboxBodyStart(line);
		if (bodyStart !== null && cursor.ch >= bodyStart) {
			const bodyBeforeCursor = line.slice(bodyStart, cursor.ch);
			const leadingMatch = LEADING_DATE_TRIGGER_RE.exec(bodyBeforeCursor);
			if (leadingMatch) {
				const query = leadingMatch[1];
				// The replacement span starts at the ":" itself, not at the optional
				// "(X) " prefix the regex uses only to confirm leading position — the
				// prefix must survive the replacement untouched.
				return {
					start: { line: cursor.line, ch: cursor.ch - 1 - query.length },
					end: cursor,
					query,
				};
			}
		}

		const match = TRIGGER_RE.exec(beforeCursor);
		if (!match) return null;

		const query = match[1];
		return {
			start: { line: cursor.line, ch: cursor.ch - query.length },
			end: cursor,
			query,
		};
	}

	getSuggestions(context: EditorSuggestContext): DateShortcutSuggestion[] {
		return suggestDateShortcuts(context.query, this.clock);
	}

	renderSuggestion(value: DateShortcutSuggestion, el: HTMLElement): void {
		el.addClass("todotxt-md-date-suggestion");
		el.createSpan({ text: value.token, cls: "todotxt-md-date-suggestion-token" });
		if (value.iso) {
			el.createSpan({ text: ` -> ${value.iso}`, cls: "todotxt-md-date-suggestion-date" });
		}
		el.createSpan({ text: ` (${value.label})`, cls: "todotxt-md-date-suggestion-label" });
	}

	selectSuggestion(value: DateShortcutSuggestion, _evt: MouseEvent | KeyboardEvent): void {
		if (!value.iso || !this.context) return;
		const { start, end, editor } = this.context;

		editor.replaceRange(value.iso, start, end);
		editor.setCursor({ line: start.line, ch: start.ch + value.iso.length });
	}
}
