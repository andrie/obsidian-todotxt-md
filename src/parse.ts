/**
 * Single source of truth for the task-line grammar (see SPEC.md "Task line grammar" and
 * "Parse leniency contract"). No other module may parse or emit task syntax with ad-hoc
 * regex — operate on the parsed Task, not raw strings.
 */

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
	contexts: string[];
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
	const contexts: string[] = [];
	let due: string | null = null;
	let threshold: string | null = null;

	const words = body.split(" ");
	const remainder: string[] = [];

	for (const word of words) {
		if (word.startsWith("+") && word.length > 1) {
			projects.push(word.slice(1));
			continue;
		}
		if (word.startsWith("#") && word.length > 1) {
			contexts.push(word.slice(1));
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
		parts.push(`#${context}`);
	}
	if (task.due) {
		parts.push(`due:${task.due}`);
	}
	if (task.threshold) {
		parts.push(`t:${task.threshold}`);
	}

	return parts.join(" ");
}
