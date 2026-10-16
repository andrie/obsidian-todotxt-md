/**
 * Splits task text into plain-text and [[wikilink]] segments, for rendering in the aggregated
 * view. Display-only: the stored task text is never rewritten. Not task grammar (links are
 * Markdown, not todo.txt), so this lives outside parse.ts.
 */

export type LinkSegment =
	{ kind: "text"; text: string } | { kind: "link"; target: string; display: string };

// Optional leading "!" marks an embed; group 2 is the target, group 3 the optional alias.
const WIKILINK_RE = /(!?)\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]/g;

function displayFor(target: string, alias: string | undefined): string {
	if (alias !== undefined && alias.trim() !== "") return alias.trim();
	return target
		.split("#")
		.map((part) => part.trim())
		.filter((part) => part !== "")
		.join(" > ");
}

export function splitWikilinks(text: string): LinkSegment[] {
	const segments: LinkSegment[] = [];
	let textStart = 0;

	for (const match of text.matchAll(WIKILINK_RE)) {
		const [whole, bang, rawTarget, alias] = match;
		const target = rawTarget.trim();
		// Embeds stay literal, and so does a link with nothing to point at.
		if (bang === "!" || target === "") continue;

		const start = match.index ?? 0;
		if (start > textStart) segments.push({ kind: "text", text: text.slice(textStart, start) });
		segments.push({ kind: "link", target, display: displayFor(target, alias) });
		textStart = start + whole.length;
	}

	if (textStart < text.length) segments.push({ kind: "text", text: text.slice(textStart) });
	return segments;
}
