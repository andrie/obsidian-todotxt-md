import type { Editor, EditorPosition } from "obsidian";
import { parseTaskLine, serializeTask, type Task } from "./parse";
import { bumpPriority } from "./priority";
import { expandDateToken, type Clock } from "./dates";
import { sortLines, defaultComparator } from "./sort";

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
 * re-anchored to the same task (tracked by its original line text) rather than the same line
 * index, since sorting changes which task occupies which line (SPEC.md "Editor mechanics").
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
	const sortedIndices = [...indices].sort(
		(i, j) => defaultComparator(blockLines[i], blockLines[j]),
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
 * Toggles done state on a Task, prepending/stripping the completion date per the todo.txt
 * convention. due:/t: are left untouched on completion (SPEC.md "Completion field handling")
 * — a completed task keeps its due date as a historical record. Pure: no Obsidian types, so
 * it's reusable by both the cursor-based command below and the aggregated view's checkbox
 * (view.ts), which has no open Editor to operate on.
 */
export function toggleDone(task: Task, clock: Clock): Task {
	return task.done
		? { ...task, done: false, completionDate: null }
		: { ...task, done: true, completionDate: expandDateToken("tod", clock) };
}

/**
 * Toggles done state on the cursor's line, via toggleDone. No-ops if the cursor isn't on a
 * task line.
 */
export function toggleDoneAtCursor(editor: Editor, clock: Clock): void {
	const found = currentLineTask(editor);
	if (!found) return;

	const { task, lineNumber } = found;
	const cursor = editor.getCursor();
	const before = serializeTask(task);

	const updated = toggleDone(task, clock);

	const after = serializeTask(updated);
	replaceLine(editor, lineNumber, after);

	const delta = after.length - before.length;
	const newCh = Math.max(0, cursor.ch + delta);
	editor.setCursor({ line: lineNumber, ch: newCh });
}
