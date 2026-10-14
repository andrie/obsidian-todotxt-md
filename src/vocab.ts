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
 * `limit`. An exact match used only once is dropped: that is almost certainly the token the user
 * is typing right now, which autosave has already written to disk.
 */
export function rankVocab(counts: CountMap, query: string, limit: number): VocabEntry[] {
	const lowerQuery = query.toLowerCase();
	return [...counts]
		.filter(
			([name, count]) =>
				name.toLowerCase().startsWith(lowerQuery) && !(name === query && count === 1),
		)
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
		.slice(0, limit);
}

/** Same folder-scoping rule as the aggregated view's `scanFolders` setting; empty = whole vault. */
export function isInScanFolders(path: string, folders: string[]): boolean {
	return (
		folders.length === 0 ||
		folders.some((folder) => path === folder || path.startsWith(folder + "/"))
	);
}
