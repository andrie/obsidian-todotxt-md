/**
 * Decides which inline popup (if any) the cursor position should open. Pure: takes the line
 * text and cursor offset, returns what fired and which span a selection replaces. The regexes
 * below match transient *popup input* (":", "due:", "!", "+", "@"), not stored task grammar —
 * recognising tasks and the checkbox prefix stays in parse.ts. Every trigger requires the
 * boundary the parser itself enforces (line start or preceding whitespace): substring matches
 * misfire on `#due:` and similar (SPEC.md, 2026-09-20 lesson), and a replacement span that
 * covers more than the typed query eats adjacent tokens (2026-10-04 lesson).
 */
import { parseTaskLine, checkboxBodyStart } from "./parse";

export type TriggerKind = "date" | "priority" | "project" | "at" | "field";

export interface TriggerMatch {
	kind: TriggerKind;
	/** Line offsets; [start, end) is replaced on selection. */
	start: number;
	end: number;
	/** Text typed after the trigger symbol (empty for the field menu). */
	query: string;
}

export interface TriggerOptions {
	fieldMenu: boolean;
}

const DATE_TRIGGER_RE = /(?:^|\s)(?:due|t):([A-Za-z0-9+]*)$/;
/** Bare ":" right after the checkbox or after a "(X) " priority token; never persisted. */
const LEADING_DATE_TRIGGER_RE = /^(?:\([A-Za-z]\)\s+)?:([A-Za-z0-9+]*)$/;
/** Transient "!" opens the A-E priority sub-list; consumed on selection, never persisted. */
const PRIORITY_TRIGGER_RE = /(?:^|\s)!([A-Za-z]*)$/;
const VOCAB_TRIGGER_RE = /(?:^|\s)([+@])([^\s]*)$/;

export function detectTrigger(
	line: string,
	ch: number,
	options: TriggerOptions,
): TriggerMatch | null {
	const task = parseTaskLine(line);
	if (!task) return null;

	const bodyStart = checkboxBodyStart(line);
	if (bodyStart === null || ch < bodyStart) return null;

	const beforeCursor = line.slice(0, ch);
	const body = line.slice(bodyStart, ch);

	const leading = LEADING_DATE_TRIGGER_RE.exec(body);
	if (leading) {
		const query = leading[1];
		// The span starts at the ":" itself; the optional "(X) " prefix only confirms leading
		// position and must survive the replacement.
		return { kind: "date", start: ch - 1 - query.length, end: ch, query };
	}

	const date = DATE_TRIGGER_RE.exec(beforeCursor);
	if (date) {
		const query = date[1];
		return { kind: "date", start: ch - query.length, end: ch, query };
	}

	if (task.priority === null) {
		const priority = PRIORITY_TRIGGER_RE.exec(body);
		if (priority) {
			const query = priority[1];
			return { kind: "priority", start: ch - 1 - query.length, end: ch, query };
		}
	}

	const vocab = VOCAB_TRIGGER_RE.exec(body);
	if (vocab) {
		const query = vocab[2];
		return {
			kind: vocab[1] === "+" ? "project" : "at",
			start: ch - 1 - query.length,
			end: ch,
			query,
		};
	}

	if (options.fieldMenu) {
		const afterWord = body.length >= 2 && body.endsWith(" ") && !/\s/.test(body[body.length - 2]);
		// A brand-new task: "- [ ] " with nothing after the cursor, so priority can come first.
		const newTask = body === "" && ch === line.length && beforeCursor.endsWith(" ");
		if (afterWord || newTask) return { kind: "field", start: ch, end: ch, query: "" };
	}

	return null;
}

/** True when `line` is `previous` with exactly one space typed at offset `ch - 1`. */
export function isSingleSpaceInsertion(previous: string, line: string, ch: number): boolean {
	return (
		ch >= 1 &&
		line[ch - 1] === " " &&
		line.length === previous.length + 1 &&
		line.slice(0, ch - 1) + line.slice(ch) === previous
	);
}

/**
 * Remembers whether the cursor is sitting right after a space the user just *typed*. The field
 * menu must only open then: opening it for any cursor position after a space would also fire
 * after a selection that leaves a trailing space (e.g. a completed +Project), and on plain
 * click/arrow navigation, where it would capture Up/Down/Enter. Feed it every onTrigger call;
 * unchanged re-checks of the same line keep the state, so a repeated call doesn't close the menu.
 */
export class TypedSpaceTracker {
	private last: { lineNo: number; text: string; lineCount?: number } | null = null;
	private typed: { lineNo: number; text: string; ch: number } | null = null;

	/**
	 * `lineCount` (the document's line total) lets a task line created by Enter be told apart
	 * from the cursor merely moving onto an existing line: Enter adds exactly one line and puts
	 * the cursor at the end of the new one.
	 */
	observe(lineNo: number, text: string, ch: number, lineCount?: number): void {
		const last = this.last;
		const createdByEnter =
			!!last &&
			lineCount !== undefined &&
			last.lineCount !== undefined &&
			lineCount === last.lineCount + 1 &&
			lineNo === last.lineNo + 1 &&
			ch === text.length;
		if (createdByEnter) {
			this.typed = { lineNo, text, ch };
		} else if (!last || last.lineNo !== lineNo) {
			this.typed = null;
		} else if (last.text !== text) {
			this.typed = isSingleSpaceInsertion(last.text, text, ch) ? { lineNo, text, ch } : null;
		}
		this.last = { lineNo, text, lineCount };
	}

	debugLast(): string { // DEBUG-TEMP
		return this.last ? `${this.last.lineNo}/${this.last.lineCount}` : "none";
	}

	isTyped(lineNo: number, text: string, ch: number): boolean {
		const typed = this.typed;
		return !!typed && typed.lineNo === lineNo && typed.text === text && typed.ch === ch;
	}
}
