import { parseTaskLine, type Task } from "./parse";

/**
 * Default comparator operating on parsed Tasks directly: priority ascending (none last),
 * then due date ascending (none last), then creation date ascending (none last). Shared by
 * this file's line-based compareLines and aggregate.ts's Task-based sorting so both stay
 * in sync (DESIGN_RULES.md section 3.2: sorting must be stable and total).
 */
export function compareTasks(a: Task, b: Task): number {
	const prioA = a.priority ?? "￿";
	const prioB = b.priority ?? "￿";
	if (prioA !== prioB) return prioA < prioB ? -1 : 1;

	const dueA = a.due ?? "￿";
	const dueB = b.due ?? "￿";
	if (dueA !== dueB) return dueA < dueB ? -1 : 1;

	const creationA = a.creationDate ?? "￿";
	const creationB = b.creationDate ?? "￿";
	if (creationA !== creationB) return creationA < creationB ? -1 : 1;

	return 0;
}

function compareLines(a: string, b: string): number {
	const taskA = parseTaskLine(a);
	const taskB = parseTaskLine(b);

	if (!taskA && !taskB) return 0;
	if (!taskA) return 1;
	if (!taskB) return -1;

	return compareTasks(taskA, taskB);
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
