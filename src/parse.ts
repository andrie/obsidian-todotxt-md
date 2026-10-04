/**
 * Single source of truth for the task-line grammar (see SPEC.md "Task line grammar" and
 * "Parse leniency contract"). No other module may parse or emit task syntax with ad-hoc
 * regex — operate on the parsed Task, not raw strings.
 */

export interface ContextToken {
	name: string;
	prefix: "@" | "#";
}

export interface Task {
	/** Leading whitespace/list-marker indentation, preserved verbatim. */
	indent: string;
	done: boolean;
	/** Completion date, only present when done. ISO YYYY-MM-DD. */
	completionDate: string | null;
	/** Priority letter A-Z, only recognized immediately after the checkbox. */
	priority: string | null;
	/** Bare leading date (todo.txt creation-date convention). ISO YYYY-MM-DD. */
	creationDate: string | null;
	/** Free-text description with recognized tokens removed, extra tokens left inline. */
	description: string;
	projects: string[];
	/** @context and #context are both accepted; each token's original prefix is preserved. */
	contexts: ContextToken[];
	due: string | null;
	threshold: string | null;
}

const CHECKBOX_RE = /^(\s*[-*]\s\[)([ xX])(\]\s?)(.*)$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITY_RE = /^\(([A-Za-z])\)\s*/;
const LEADING_DATE_RE = /^(\d{4}-\d{2}-\d{2})\s+/;

/**
 * Parses a single line. Returns null iff the line is not a Markdown checkbox — that is the
 * only gate (see SPEC.md "Parse leniency contract"). Once a line passes the checkbox gate,
 * the body always parses successfully: recognized tokens populate Task fields in the order
 * they appear, and anything the grammar doesn't recognize (out-of-position tokens,
 * duplicates, non-ISO dates) is preserved verbatim in `description` rather than dropped.
 */
export function parseTaskLine(line: string): Task | null {
	const checkboxMatch = CHECKBOX_RE.exec(line);
	if (!checkboxMatch) return null;

	const [, prefix, mark, , rest] = checkboxMatch;
	const done = mark === "x" || mark === "X";
	const indent = prefix.match(/^\s*/)?.[0] ?? "";

	let body = rest;

	let completionDate: string | null = null;
	if (done) {
		const completionMatch = LEADING_DATE_RE.exec(body);
		if (completionMatch) {
			completionDate = completionMatch[1];
			body = body.slice(completionMatch[0].length);
		}
	}

	let priority: string | null = null;
	const priorityMatch = PRIORITY_RE.exec(body);
	if (priorityMatch) {
		priority = priorityMatch[1].toUpperCase();
		body = body.slice(priorityMatch[0].length);
	}

	let creationDate: string | null = null;
	const creationMatch = LEADING_DATE_RE.exec(body);
	if (creationMatch) {
		creationDate = creationMatch[1];
		body = body.slice(creationMatch[0].length);
	}

	const projects: string[] = [];
	const contexts: ContextToken[] = [];
	let due: string | null = null;
	let threshold: string | null = null;

	const words = body.split(" ");
	const remainder: string[] = [];

	for (const word of words) {
		if (word.startsWith("+") && word.length > 1) {
			projects.push(word.slice(1));
			continue;
		}
		if ((word.startsWith("@") || word.startsWith("#")) && word.length > 1) {
			contexts.push({ name: word.slice(1), prefix: word[0] as "@" | "#" });
			continue;
		}
		if (word.startsWith("due:")) {
			const value = word.slice(4);
			if (ISO_DATE_RE.test(value) && due === null) {
				due = value;
				continue;
			}
		}
		if (word.startsWith("t:")) {
			const value = word.slice(2);
			if (ISO_DATE_RE.test(value) && threshold === null) {
				threshold = value;
				continue;
			}
		}
		remainder.push(word);
	}

	const description = remainder.join(" ").trim();

	return {
		indent,
		done,
		completionDate,
		priority,
		creationDate,
		description,
		projects,
		contexts,
		due,
		threshold,
	};
}

export interface TokenSpan {
	/** 0-indexed offset into the original line string (not the sliced `body`). */
	start: number;
	end: number;
	kind:
		| "priority"
		| "creationDate"
		| "completionDate"
		| "project"
		| "context"
		| "due"
		| "threshold";
}

/**
 * Same parse as parseTaskLine, but also returns each recognized token's [start, end) offset in
 * the original line. Mirrors parseTaskLine's exact consumption order and logic so the two
 * functions never disagree about which token is "the real one" in ambiguous cases (e.g.
 * duplicate due:). Used only by the in-editor decoration layer (src/highlight.ts).
 */
export function parseTaskLineWithSpans(line: string): { task: Task; spans: TokenSpan[] } | null {
	const checkboxMatch = CHECKBOX_RE.exec(line);
	if (!checkboxMatch) return null;

	const [, prefix, mark, bracketClose, rest] = checkboxMatch;
	const done = mark === "x" || mark === "X";
	const indent = prefix.match(/^\s*/)?.[0] ?? "";

	const spans: TokenSpan[] = [];
	let offset = prefix.length + mark.length + bracketClose.length;
	let body = rest;

	let completionDate: string | null = null;
	if (done) {
		const completionMatch = LEADING_DATE_RE.exec(body);
		if (completionMatch) {
			completionDate = completionMatch[1];
			spans.push({
				kind: "completionDate",
				start: offset,
				end: offset + completionMatch[1].length,
			});
			body = body.slice(completionMatch[0].length);
			offset += completionMatch[0].length;
		}
	}

	let priority: string | null = null;
	const priorityMatch = PRIORITY_RE.exec(body);
	if (priorityMatch) {
		priority = priorityMatch[1].toUpperCase();
		spans.push({ kind: "priority", start: offset, end: offset + priorityMatch[1].length + 2 });
		body = body.slice(priorityMatch[0].length);
		offset += priorityMatch[0].length;
	}

	let creationDate: string | null = null;
	const creationMatch = LEADING_DATE_RE.exec(body);
	if (creationMatch) {
		creationDate = creationMatch[1];
		spans.push({ kind: "creationDate", start: offset, end: offset + creationMatch[1].length });
		body = body.slice(creationMatch[0].length);
		offset += creationMatch[0].length;
	}

	const projects: string[] = [];
	const contexts: ContextToken[] = [];
	let due: string | null = null;
	let threshold: string | null = null;

	const words = body.split(" ");
	const remainder: string[] = [];

	for (const word of words) {
		const wordStart = offset;
		offset += word.length + 1; // +1 for the space split() consumed

		if (word.startsWith("+") && word.length > 1) {
			projects.push(word.slice(1));
			spans.push({ kind: "project", start: wordStart, end: wordStart + word.length });
			continue;
		}
		if ((word.startsWith("@") || word.startsWith("#")) && word.length > 1) {
			contexts.push({ name: word.slice(1), prefix: word[0] as "@" | "#" });
			spans.push({ kind: "context", start: wordStart, end: wordStart + word.length });
			continue;
		}
		if (word.startsWith("due:")) {
			const value = word.slice(4);
			if (ISO_DATE_RE.test(value) && due === null) {
				due = value;
				spans.push({ kind: "due", start: wordStart, end: wordStart + word.length });
				continue;
			}
		}
		if (word.startsWith("t:")) {
			const value = word.slice(2);
			if (ISO_DATE_RE.test(value) && threshold === null) {
				threshold = value;
				spans.push({ kind: "threshold", start: wordStart, end: wordStart + word.length });
				continue;
			}
		}
		remainder.push(word);
	}

	const description = remainder.join(" ").trim();

	const task: Task = {
		indent,
		done,
		completionDate,
		priority,
		creationDate,
		description,
		projects,
		contexts,
		due,
		threshold,
	};

	return { task, spans };
}

const MALFORMED_PRIORITY_RE = /^(\[|\{|<|\()([A-Za-z0-9]{1,2})(\]|\}|>|\))\s*/;

/**
 * Detects a priority-shaped-but-invalid token in the leading position (immediately after the
 * checkbox) — wrong bracket character, or parenthesized content that isn't exactly one A-Z/a-z
 * letter. Independent of parseTaskLineWithSpans: a not-recognized leading token is exactly what
 * parseTaskLine already leaves untouched in `description`, so this is a separate "does this
 * look like an attempted priority" heuristic, not a grammar rule. Only scans the leading
 * position (mirrors PRIORITY_RE's own position restriction) — never mid-description. Returns
 * null if there's no checkbox, or nothing priority-shaped is present. Does NOT flag a token
 * already recognized by PRIORITY_RE (valid "(A)" or lowercase "(a)") — those are a separate
 * "will be normalized" case the decoration layer derives directly from
 * parseTaskLineWithSpans's priority span.
 */
export function detectMalformedPriority(line: string): TokenSpan | null {
	const checkboxMatch = CHECKBOX_RE.exec(line);
	if (!checkboxMatch) return null;

	const [, prefix, mark, bracketClose, rest] = checkboxMatch;
	const offset = prefix.length + mark.length + bracketClose.length;

	if (PRIORITY_RE.test(rest)) return null;

	const malformedMatch = MALFORMED_PRIORITY_RE.exec(rest);
	if (!malformedMatch) return null;

	return {
		kind: "priority",
		start: offset,
		end: offset + malformedMatch[0].trimEnd().length,
	};
}

/**
 * Reproduces a semantically-equivalent line for a Task produced by parseTaskLine, in
 * canonical token order (see SPEC.md "canonical token order" / DESIGN_RULES.md section 2.3).
 * Any tokens the parser couldn't place stay in `description` as literal text and are
 * reproduced there, satisfying round-trip fidelity for messy input.
 */
export function serializeTask(task: Task): string {
	const mark = task.done ? "x" : " ";
	const parts: string[] = [`${task.indent}- [${mark}]`];

	if (task.done && task.completionDate) {
		parts.push(task.completionDate);
	}
	if (task.priority) {
		parts.push(`(${task.priority})`);
	}
	if (task.creationDate) {
		parts.push(task.creationDate);
	}
	if (task.description) {
		parts.push(task.description);
	}
	for (const project of task.projects) {
		parts.push(`+${project}`);
	}
	for (const context of task.contexts) {
		parts.push(`${context.prefix}${context.name}`);
	}
	if (task.due) {
		parts.push(`due:${task.due}`);
	}
	if (task.threshold) {
		parts.push(`t:${task.threshold}`);
	}

	return parts.join(" ");
}
