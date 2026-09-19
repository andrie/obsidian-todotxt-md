import type { Task } from "./parse";

const FIRST_PRIORITY = "A";
const LAST_PRIORITY = "Z";

/**
 * Cycles a task's priority by +1 (decrease urgency, A -> B) or -1 (increase urgency, B -> A).
 * Increasing from none starts at defaultPriority (PLAN.md: settled on "A"). Decreasing from
 * "A" clears the priority (cycles to none), matching a bounded A-Z cycle with "none" as an
 * edge state rather than wrapping Z<->A.
 */
export function bumpPriority(
	task: Task,
	direction: 1 | -1,
	defaultPriority: string = FIRST_PRIORITY,
): Task {
	const current = task.priority;

	if (direction === -1) {
		// Increase urgency: none -> default, X -> X-1, A -> stays A (already max urgency).
		if (current === null) {
			return { ...task, priority: defaultPriority };
		}
		if (current === FIRST_PRIORITY) {
			return task;
		}
		const next = String.fromCharCode(current.charCodeAt(0) - 1);
		return { ...task, priority: next };
	}

	// Decrease urgency: none -> stays none, Z -> stays Z, A -> B -> ... -> Z -> none.
	if (current === null) {
		return task;
	}
	if (current === LAST_PRIORITY) {
		return { ...task, priority: null };
	}
	const next = String.fromCharCode(current.charCodeAt(0) + 1);
	return { ...task, priority: next };
}
