import { parseTaskLine } from "./parse";

/**
 * Default comparator: priority ascending (A before B, none last), then due date ascending
 * (no due date last), then creation date ascending (no creation date last). Total and stable
 * so output is deterministic (DESIGN_RULES.md section 3.2) — non-task lines and ties fall
 * back to original input order via Array.prototype.sort's stability guarantee.
 */
function compareLines(a: string, b: string): number {
	const taskA = parseTaskLine(a);
	const taskB = parseTaskLine(b);

	// Non-task lines sort after tasks but keep relative order among themselves.
	if (!taskA && !taskB) return 0;
	if (!taskA) return 1;
	if (!taskB) return -1;

	const prioA = taskA.priority ?? "￿";
	const prioB = taskB.priority ?? "￿";
	if (prioA !== prioB) return prioA < prioB ? -1 : 1;

	const dueA = taskA.due ?? "￿";
	const dueB = taskB.due ?? "￿";
	if (dueA !== dueB) return dueA < dueB ? -1 : 1;

	const creationA = taskA.creationDate ?? "￿";
	const creationB = taskB.creationDate ?? "￿";
	if (creationA !== creationB) return creationA < creationB ? -1 : 1;

	return 0;
}

/**
 * Sorts a contiguous block of lines in place (returns a new array — caller writes it back).
 * A comparator may be supplied to override the default ordering; sort is stable regardless.
 */
export function sortLines(
	lines: string[],
	comparator: (a: string, b: string) => number = compareLines,
): string[] {
	return [...lines].sort(comparator);
}

export { compareLines as defaultComparator };
