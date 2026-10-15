/**
 * Note-level metadata from the `todotxt:` front matter key, or the flat `todotxt-*` keys (see
 * the 2026-10-15 spec). Pure: the YAML parser is injected, so this runs in plain Node. This
 * module handles front matter, not task syntax; the task grammar stays in parse.ts.
 */
import type { ContextToken } from "./parse";

export interface NoteMeta {
	/** The note is left out of the aggregated view and the inline-suggestion vocabulary. */
	ignore: boolean;
	/** Bare names, no `+`. */
	projects: string[];
	/** Prefix preserved; a name given without a sigil gets `@`. */
	contexts: ContextToken[];
}

function emptyMeta(): NoteMeta {
	return { ignore: false, projects: [], contexts: [] };
}

/** The YAML text between the leading `---` lines, or null when the note has no closed block. */
export function splitFrontmatter(content: string): string | null {
	const lines = (content.charCodeAt(0) === 0xfeff ? content.slice(1) : content).split(/\r?\n/);
	if (lines[0]?.trimEnd() !== "---") return null;
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trimEnd();
		if (line === "---" || line === "...") return lines.slice(1, i).join("\n");
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A list or a single scalar becomes trimmed strings; anything else is dropped. */
function toNames(value: unknown): string[] {
	const items = Array.isArray(value) ? value : [value];
	const names: string[] = [];
	for (const item of items) {
		if (typeof item === "string") names.push(item.trim());
		else if (typeof item === "number") names.push(String(item));
	}
	return names;
}

/** Tokens are space-delimited in parse.ts, so a name with whitespace could never match. */
function isValidName(name: string): boolean {
	return name.length > 0 && !/\s/.test(name);
}

function isTrue(value: unknown): boolean {
	return value === true || (typeof value === "string" && value.trim().toLowerCase() === "true");
}

/**
 * Reads both spellings: the nested `todotxt:` map and the flat `todotxt-ignore` /
 * `todotxt-projects` / `todotxt-contexts` keys, which Obsidian's Properties editor can edit
 * (it cannot edit nested maps). When both appear they combine: ignore if either says so, lists
 * unioned.
 */
export function parseNoteMeta(frontmatter: unknown): NoteMeta {
	const meta = emptyMeta();
	if (!isRecord(frontmatter)) return meta;
	const nested = isRecord(frontmatter.todotxt) ? frontmatter.todotxt : {};

	meta.ignore = isTrue(nested.ignore) || isTrue(frontmatter["todotxt-ignore"]);

	for (const raw of [...toNames(nested.projects), ...toNames(frontmatter["todotxt-projects"])]) {
		const name = raw.startsWith("+") ? raw.slice(1) : raw;
		if (isValidName(name) && !meta.projects.includes(name)) meta.projects.push(name);
	}

	for (const raw of [...toNames(nested.contexts), ...toNames(frontmatter["todotxt-contexts"])]) {
		const explicit = raw.startsWith("@") || raw.startsWith("#");
		const prefix = raw.startsWith("#") ? "#" : "@";
		const name = explicit ? raw.slice(1) : raw;
		if (!isValidName(name)) continue;
		if (!meta.contexts.some((c) => c.name === name && c.prefix === prefix)) {
			meta.contexts.push({ name, prefix });
		}
	}
	return meta;
}

/** Front matter of `content` as NoteMeta. Unparseable YAML means "no metadata", never a throw. */
export function readNoteMeta(content: string, parseYaml: (text: string) => unknown): NoteMeta {
	const block = splitFrontmatter(content);
	if (block === null) return emptyMeta();
	try {
		return parseNoteMeta(parseYaml(block));
	} catch {
		return emptyMeta();
	}
}
