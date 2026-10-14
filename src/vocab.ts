/**
 * Vocabulary of names already used in the vault's tasks (+projects, @places, #tags), for the
 * inline +/@ completion popup. Pure: callers pass lines in, so this runs in plain Node. Uses
 * parseTaskLine for all recognition — no task-syntax regexes here (DESIGN_RULES.md: parse.ts
 * owns the grammar).
 */
import { parseTaskLine } from "./parse";

export type VocabKind = "project" | "at" | "hash";
export type CountMap = Map<string, number>;
export type FileVocab = Record<VocabKind, CountMap>;

export interface VocabEntry {
	name: string;
	count: number;
}

const KINDS: VocabKind[] = ["project", "at", "hash"];

function emptyVocab(): FileVocab {
	return { project: new Map(), at: new Map(), hash: new Map() };
}

function bump(map: CountMap, name: string, by = 1): void {
	map.set(name, (map.get(name) ?? 0) + by);
}

/** Counts the names used by the checkbox tasks among `lines`. Non-task lines are ignored. */
export function extractFileVocab(lines: string[]): FileVocab {
	const vocab = emptyVocab();
	for (const line of lines) {
		const task = parseTaskLine(line);
		if (!task) continue;
		for (const project of task.projects) bump(vocab.project, project);
		for (const context of task.contexts) {
			bump(context.prefix === "@" ? vocab.at : vocab.hash, context.name);
		}
	}
	return vocab;
}

export function mergeVocab(files: Iterable<FileVocab>): FileVocab {
	const merged = emptyVocab();
	for (const file of files) {
		for (const kind of KINDS) {
			for (const [name, count] of file[kind]) bump(merged[kind], name, count);
		}
	}
	return merged;
}

/**
 * Names whose lowercase form starts with `query`, most-used first (ties alphabetical), capped at
 * `limit`. Callers pass counts already adjusted for the open note (see adjustVocab), so the token
 * being typed is not in them.
 */
export function rankVocab(counts: CountMap, query: string, limit: number): VocabEntry[] {
	const lowerQuery = query.toLowerCase();
	return [...counts]
		.filter(([name]) => name.toLowerCase().startsWith(lowerQuery))
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
		.slice(0, limit);
}

/**
 * `base` with one file's cached contribution (`remove`, if any) swapped for its live content
 * (`add`). Used for the open note: its on-disk cache lags the editor (autosave), so a half-typed
 * "+Fin" would otherwise be offered back to the user. Returns new maps; `base` is not mutated.
 */
export function adjustVocab(
	base: FileVocab,
	remove: FileVocab | undefined,
	add: FileVocab,
): FileVocab {
	const result = emptyVocab();
	for (const kind of KINDS) {
		for (const [name, count] of base[kind]) result[kind].set(name, count);
		for (const [name, count] of remove?.[kind] ?? []) {
			const remaining = (result[kind].get(name) ?? 0) - count;
			if (remaining > 0) result[kind].set(name, remaining);
			else result[kind].delete(name);
		}
		for (const [name, count] of add[kind]) bump(result[kind], name, count);
	}
	return result;
}

/** Same folder-scoping rule as the aggregated view's `scanFolders` setting; empty = whole vault. */
export function isInScanFolders(path: string, folders: string[]): boolean {
	return (
		folders.length === 0 ||
		folders.some((folder) => path === folder || path.startsWith(folder + "/"))
	);
}
