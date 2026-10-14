/**
 * Field-menu suggestions and the exact text edits that selecting them performs. Pure: all
 * decisions are made against the parsed task (parse.ts) and returned as offset-based edit
 * plans, so the Obsidian glue only has to apply them. Edits are local insertions — the line is
 * never re-serialised — so tokens the user is mid-way through typing are never reordered.
 */
import { parseTaskLine, parseTaskLineWithSpans, checkboxBodyStart, type TokenSpan } from "./parse";
import { expandDateToken, type Clock } from "./dates";

export type FieldKind = "priority" | "created" | "due" | "threshold" | "project" | "at" | "hash";

export interface FieldSuggestion {
	kind: FieldKind;
	label: string;
	hint: string;
}

export interface Span {
	start: number;
	end: number;
}

/** Offsets are against the original line; edits in a plan are ascending by `from`. */
export interface TextEdit {
	from: number;
	to: number;
	insert: string;
}

export interface EditPlan {
	edits: TextEdit[];
	/** Cursor offset in the line *after* all edits are applied. */
	cursor: number;
}

const TRANSIENT_TEXT: Partial<Record<FieldKind, string>> = {
	priority: "!",
	due: "due:",
	threshold: "t:",
	project: "+",
	at: "@",
	hash: "#",
};

export function suggestFields(line: string, clock: Clock): FieldSuggestion[] {
	const task = parseTaskLine(line);
	if (!task) return [];

	const today = expandDateToken("tod", clock) ?? "";
	const rows: Array<FieldSuggestion & { show: boolean }> = [
		{ kind: "priority", label: "Priority", hint: "(A)-(E)", show: task.priority === null },
		{
			kind: "created",
			label: "Created",
			hint: today,
			show: !task.done && task.creationDate === null,
		},
		{ kind: "due", label: "due:", hint: "due date", show: task.due === null },
		{ kind: "threshold", label: "t:", hint: "start date", show: task.threshold === null },
		{ kind: "project", label: "+", hint: "project", show: true },
		{ kind: "at", label: "@", hint: "place / context", show: true },
		{ kind: "hash", label: "#", hint: "tag / context", show: true },
	];
	return rows.filter((row) => row.show).map(({ kind, label, hint }) => ({ kind, label, hint }));
}

/** Maps a pre-edit offset to its position after applying `edits` (ascending by `from`). */
function mapCursor(offset: number, edits: TextEdit[]): number {
	let result = offset;
	for (const edit of edits) {
		if (edit.to <= offset) result += edit.insert.length - (edit.to - edit.from);
	}
	return result;
}

export function planReplace(span: Span, insert: string): EditPlan {
	return {
		edits: [{ from: span.start, to: span.end, insert }],
		cursor: span.start + insert.length,
	};
}

/** Order in which to apply edits so earlier offsets are not invalidated by later ones. */
export function editsDescending(plan: EditPlan): TextEdit[] {
	return [...plan.edits].sort((a, b) => b.from - a.from || b.to - a.to);
}

export function applyEditPlan(line: string, plan: EditPlan): string {
	let result = line;
	for (const edit of editsDescending(plan)) {
		result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
	}
	return result;
}

/** Offset where a priority token belongs: after a completion date if present, else body start. */
function priorityOffset(line: string, spans: TokenSpan[], bodyStart: number): number {
	const completion = spans.find((span) => span.kind === "completionDate");
	return completion ? Math.min(completion.end + 1, line.length) : bodyStart;
}

function createdEdit(line: string, spans: TokenSpan[], bodyStart: number, iso: string): TextEdit {
	const priority = spans.find((span) => span.kind === "priority");
	if (!priority) {
		const at = priorityOffset(line, spans, bodyStart);
		return { from: at, to: at, insert: `${iso} ` };
	}
	if (line[priority.end] === " ") {
		return { from: priority.end + 1, to: priority.end + 1, insert: `${iso} ` };
	}
	return { from: priority.end, to: priority.end, insert: ` ${iso} ` };
}

/**
 * Plan for selecting a field-menu row with the cursor at `ch`. Most rows insert transient
 * trigger text at the cursor so the next popup fires (due: -> date popup, + -> project popup,
 * ! -> priority sub-list). "created" inserts today's date directly in the leading slot.
 */
export function planFieldEdit(
	line: string,
	ch: number,
	kind: FieldKind,
	clock: Clock,
): EditPlan | null {
	const parsed = parseTaskLineWithSpans(line);
	const bodyStart = checkboxBodyStart(line);
	if (!parsed || bodyStart === null) return null;

	if (kind === "created") {
		const iso = expandDateToken("tod", clock);
		if (!iso || parsed.task.done || parsed.task.creationDate !== null) return null;
		const edits = [createdEdit(line, parsed.spans, bodyStart, iso)];
		return { edits, cursor: mapCursor(ch, edits) };
	}

	const text = TRANSIENT_TEXT[kind];
	if (text === undefined) return null;
	return { edits: [{ from: ch, to: ch, insert: text }], cursor: ch + text.length };
}

/**
 * Plan for choosing priority `letter` from the "!" sub-list. `span` is the "!query" span to
 * consume. The "(X)" token goes in the leading slot (parse.ts only recognises priority there);
 * the consumed span plus one adjacent space is removed so no double space is left behind.
 */
export function planPriorityEdit(line: string, span: Span, letter: string): EditPlan | null {
	if (!/^[A-Za-z]$/.test(letter)) return null;
	const parsed = parseTaskLineWithSpans(line);
	const bodyStart = checkboxBodyStart(line);
	if (!parsed || bodyStart === null || parsed.task.priority !== null) return null;

	const token = `(${letter.toUpperCase()})`;
	const slot = priorityOffset(line, parsed.spans, bodyStart);

	if (span.start === slot) {
		const next = line[span.end];
		const insert = next === undefined || next === " " ? token : `${token} `;
		const edits = [{ from: span.start, to: span.end, insert }];
		return { edits, cursor: mapCursor(span.end, edits) };
	}

	const removeFrom =
		line[span.start - 1] === " " && span.start - 1 > slot ? span.start - 1 : span.start;
	const edits: TextEdit[] = [
		{ from: slot, to: slot, insert: `${token} ` },
		{ from: removeFrom, to: span.end, insert: "" },
	];
	return { edits, cursor: mapCursor(span.end, edits) };
}
