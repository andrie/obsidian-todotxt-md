/**
 * Fixed palette, pre-checked to read acceptably against both Obsidian's default light and
 * dark theme backgrounds. Shared by the aggregated view's pills (view.ts) and the in-editor
 * decoration extension (highlight.ts) so a given project/context name renders as the same
 * color in both surfaces. Not user-configurable (see the aggregated-view design spec's
 * "per-name hash, not Style Settings-configurable" decision).
 */
const PALETTE: readonly string[] = [
	"#4C78A8", // blue
	"#F58518", // orange
	"#54A24B", // green
	"#B279A2", // purple
	"#E45756", // red
	"#72B7B2", // teal
	"#EECA3B", // yellow
	"#9D755D", // brown
	"#FF9DA6", // pink
	"#BAB0AC", // gray
];

/**
 * Simple, fast, stable string hash (FNV-1a variant). No cryptographic requirement — only
 * determinism (same name always maps to the same palette slot) and a reasonable spread across
 * typical project/context name sets.
 */
function hashString(value: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/** Deterministic: the same name always maps to the same palette entry. */
export function nameToColor(name: string): string {
	const index = hashString(name) % PALETTE.length;
	return PALETTE[index];
}
