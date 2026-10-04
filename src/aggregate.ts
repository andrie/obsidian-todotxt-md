import type { Task } from "./parse";
import { compareTasks } from "./sort";
import type { Clock } from "./dates";

/**
 * A parsed task plus its source location, produced by view.ts's vault scan. Pure data — no
 * Obsidian types — so this module's filter/sort logic is fully unit-testable
 * (DESIGN_RULES.md section 3.1 litmus test: "could this run in plain Node with no Obsidian
 * mock?").
 */
export interface TaskRecord {
	task: Task;
	filePath: string;
	/** 0-indexed line number, matching Editor.setCursor's line convention. */
	line: number;
}

export type DueWindow = "all" | "overdue" | "today" | "this-week" | "none";

export interface AggregateFilter {
	/**
	 * AND semantics: task must have ALL listed contexts. Bare names only, prefix-blind — a
	 * filter entry matches a task's context regardless of whether that context was typed as
	 * `@name` or `#name` (see ContextToken in parse.ts).
	 */
	contexts: string[];
	/** AND semantics: task must have ALL listed projects. */
	projects: string[];
	dueWindow: DueWindow;
	includeDone: boolean;
}

export const DEFAULT_FILTER: AggregateFilter = {
	contexts: [],
	projects: [],
	dueWindow: "all",
	includeDone: false,
};

function toIso(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
	const result = new Date(date.getTime());
	result.setDate(result.getDate() + days);
	return result;
}

/**
 * Returns whether `due` (ISO date or null) falls within `window`, evaluated relative to
 * `clock()` — never `new Date()` directly (DESIGN_RULES.md section 3.2). "This week" is a
 * rolling 7-day window (today through today+6 inclusive), not calendar-week-aligned, since
 * no first-day-of-week setting exists elsewhere in the grammar/settings.
 */
export function matchesDueWindow(due: string | null, window: DueWindow, clock: Clock): boolean {
	if (window === "all") return true;
	if (window === "none") return due === null;
	if (due === null) return false;

	const today = toIso(clock());
	if (window === "overdue") return due < today;
	if (window === "today") return due === today;

	const weekEnd = toIso(addDays(clock(), 6));
	return due >= today && due <= weekEnd;
}

/**
 * Filters and sorts a list of TaskRecords per `filter`. Sort uses compareTasks (priority, due,
 * creation date ascending) applied directly to Task objects — no line-serialize round-trip.
 */
export function aggregateTasks(
	records: TaskRecord[],
	filter: AggregateFilter,
	clock: Clock,
): TaskRecord[] {
	const filtered = records.filter(({ task }) => {
		if (!filter.includeDone && task.done) return false;
		if (filter.contexts.some((c) => !task.contexts.some((ctx) => ctx.name === c))) return false;
		if (filter.projects.some((p) => !task.projects.includes(p))) return false;
		if (!matchesDueWindow(task.due, filter.dueWindow, clock)) return false;
		return true;
	});

	return [...filtered].sort((a, b) => compareTasks(a.task, b.task));
}
