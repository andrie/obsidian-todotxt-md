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

	if (
		options.fieldMenu &&
		body.length >= 2 &&
		body.endsWith(" ") &&
		!/\s/.test(body[body.length - 2])
	) {
		return { kind: "field", start: ch, end: ch, query: "" };
	}

	return null;
}
