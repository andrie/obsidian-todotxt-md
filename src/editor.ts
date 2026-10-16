import type { Editor, EditorPosition } from "obsidian";
import { parseTaskLine, serializeTask, type Task, type TaskStatus } from "./parse";
import { bumpPriority } from "./priority";
import { expandDateToken, type Clock } from "./dates";
import { defaultComparator } from "./sort";

/**
 * Obsidian Editor glue. All rewrites go through Editor's replaceRange (CM6 transaction API)
 * per SPEC.md "Editor mechanics" — never mutate the document string directly. Every command
 * checks for a parseable task line before acting and no-ops silently otherwise (DESIGN_RULES.md
 * section 1.4, "assist, don't nag").
 */

function currentLineTask(editor: Editor): { task: Task; lineNumber: number } | null {
	const cursor = editor.getCursor();
	const lineText = editor.getLine(cursor.line);
	const task = parseTaskLine(lineText);
	if (!task) return null;
	return { task, lineNumber: cursor.line };
}

function replaceLine(editor: Editor, lineNumber: number, newText: string): void {
	const lastCh = editor.getLine(lineNumber).length;
	editor.replaceRange(newText, { line: lineNumber, ch: 0 }, { line: lineNumber, ch: lastCh });
}

/**
 * Bumps priority on the cursor's line. No-ops if the cursor isn't on a task line.
 * Priority bumps never change line length before the description, so the cursor's
 * column is preserved as-is (per SPEC.md: only operations that shift text before the
 * cursor need to recompute its offset).
 */
export function bumpPriorityAtCursor(
	editor: Editor,
	direction: 1 | -1,
	defaultPriority: string,
): void {
	const found = currentLineTask(editor);
	if (!found) return;

	const { task, lineNumber } = found;
	const cursor = editor.getCursor();
	const before = serializeTask(task);
	const updated = bumpPriority(task, direction, defaultPriority);
	const after = serializeTask(updated);

	replaceLine(editor, lineNumber, after);

	const delta = after.length - before.length;
	const newCh = Math.max(0, cursor.ch + delta);
	editor.setCursor({ line: lineNumber, ch: newCh });
}

/**
 * Expands a recognized date-shortcut token immediately before the cursor (e.g. "tod",
 * "+3d") to its ISO form. No-ops if there's no recognized token there. Explicit command
 * only for v1 — live-typing expansion is separately scoped (SPEC.md "Editor mechanics").
 */
export function expandDateTokenAtCursor(editor: Editor, clock: Clock): void {
	const cursor = editor.getCursor();
	const lineText = editor.getLine(cursor.line);
	const beforeCursor = lineText.slice(0, cursor.ch);
	const match = /(\S+)$/.exec(beforeCursor);
	if (!match) return;

	const token = match[1];
	const expanded = expandDateToken(token, clock);
	if (!expanded) return;

	const tokenStart: EditorPosition = { line: cursor.line, ch: cursor.ch - token.length };
	editor.replaceRange(expanded, tokenStart, cursor);

	editor.setCursor({ line: cursor.line, ch: tokenStart.ch + expanded.length });
}

/**
 * Sorts the contiguous checkbox block containing the cursor, rewritten in place. Cursor is
 * re-anchored by tracking the cursor's original array index through the sort (rather than
 * doing an indexOf lookup on line text), since sorting changes which task occupies which
 * line and two lines can be textually identical (SPEC.md "Editor mechanics").
 */
export function sortBlockAtCursor(editor: Editor): void {
	const cursor = editor.getCursor();
	const lastLine = editor.lastLine();
	const originalCursorLine = cursor.line;

	if (!parseTaskLine(editor.getLine(cursor.line))) return;

	let start = cursor.line;
	while (start > 0 && parseTaskLine(editor.getLine(start - 1))) {
		start--;
	}
	let end = cursor.line;
	while (end < lastLine && parseTaskLine(editor.getLine(end + 1))) {
		end++;
	}

	const blockLines: string[] = [];
	for (let i = start; i <= end; i++) {
		blockLines.push(editor.getLine(i));
	}

	const indices = blockLines.map((_, i) => i);
	const sortedIndices = [...indices].sort((i, j) =>
		defaultComparator(blockLines[i], blockLines[j]),
	);
	const sorted = sortedIndices.map((i) => blockLines[i]);
	const newRelativeIndex = sortedIndices.indexOf(originalCursorLine - start);

	editor.replaceRange(
		sorted.join("\n"),
		{ line: start, ch: 0 },
		{ line: end, ch: editor.getLine(end).length },
	);

	if (newRelativeIndex !== -1) {
		editor.setCursor({ line: start + newRelativeIndex, ch: cursor.ch });
	}
}

/**
 * Advances a Task one step round open -> in progress -> done -> open, maintaining its dates:
 * entering progress writes `start:` (today); entering done writes the completion date, and
 * the creation date too if missing (todo.txt requires one whenever there is the other);
 * going back to open drops the completion date and `start:`. The creation date is task
 * metadata and is never removed. due:/t: are left untouched (SPEC.md "Completion field
 * handling"). Pure: no Obsidian types, so it's reusable by both the cursor-based command
 * below and the aggregated view's status control (view.ts), which has no open Editor.
 */
export function cycleStatus(task: Task, clock: Clock): Task {
	const today = expandDateToken("tod", clock);
	switch (task.status) {
		case "open":
			return { ...task, status: "progress", start: today };
		case "progress":
			return {
				...task,
				status: "done",
				completionDate: today,
				creationDate: task.creationDate ?? today,
			};
		case "done":
			return { ...task, status: "open", completionDate: null, start: null };
	}
}

/** A fresh open task line, dated with today's creation date (todo.txt creation-date slot). */
export function createTaskLine(indent: string, clock: Clock): string {
	return (
		serializeTask({
			indent,
			status: "open",
			completionDate: null,
			priority: null,
			creationDate: expandDateToken("tod", clock),
			description: "",
			projects: [],
			contexts: [],
			due: null,
			threshold: null,
			start: null,
		}) + " "
	);
}

/**
 * For a line edit from `before` to `after`: if the line has just become an in-progress task
 * ("- [/]", whether typed or set by clicking a checkbox) and carries no `start:` yet, returns
 * the line with `start:` added; otherwise null. Never fires on lines that were already in
 * progress, so later edits to the description don't re-stamp the date.
 */
export function startIfEnteredProgress(before: string, after: string, clock: Clock): string | null {
	const next = parseTaskLine(after);
	if (!next || next.status !== "progress" || next.start !== null) return null;
	if (parseTaskLine(before)?.status === "progress") return null;
	return serializeTask({ ...next, start: expandDateToken("tod", clock) });
}

/** Inserts a new dated open task on the cursor's line (or below it, if that line has text). */
export function createTaskAtCursor(editor: Editor, clock: Clock): void {
	const { line } = editor.getCursor();
	const current = editor.getLine(line);
	const indent = current.match(/^\s*/)?.[0] ?? "";
	const newLine = createTaskLine(indent, clock);
	if (current.trim() === "") {
		replaceLine(editor, line, newLine);
		editor.setCursor({ line, ch: newLine.length });
	} else {
		editor.replaceRange("\n" + newLine, { line, ch: current.length });
		editor.setCursor({ line: line + 1, ch: newLine.length });
	}
}

/**
 * Cycles status on a specific line (e.g. the one whose checkbox was clicked). Returns the new
 * status, or null if that line isn't a task. The cursor is left alone.
 */
export function cycleStatusAtLine(
	editor: Editor,
	lineNumber: number,
	clock: Clock,
): TaskStatus | null {
	const task = parseTaskLine(editor.getLine(lineNumber));
	if (!task) return null;
	const updated = cycleStatus(task, clock);
	replaceLine(editor, lineNumber, serializeTask(updated));
	return updated.status;
}

/**
 * Cycles status on the cursor's line, via cycleStatus. No-ops if the cursor isn't on a
 * task line.
 */
export function cycleStatusAtCursor(editor: Editor, clock: Clock): void {
	const found = currentLineTask(editor);
	if (!found) return;

	const { task, lineNumber } = found;
	const cursor = editor.getCursor();
	const before = serializeTask(task);

	const updated = cycleStatus(task, clock);

	const after = serializeTask(updated);
	replaceLine(editor, lineNumber, after);

	const delta = after.length - before.length;
	const newCh = Math.max(0, cursor.ch + delta);
	editor.setCursor({ line: lineNumber, ch: newCh });
}
