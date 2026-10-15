// Minimal runtime stand-in for the "obsidian" package (which ships types only), so glue modules
// with simple Obsidian dependencies can be unit-tested in plain Node. Aliased in vitest.config.ts.
export class TFile {
	extension = "md";
	constructor(public path: string) {}
}

export class TAbstractFile {}

/** Runs immediately; the real debounce's timing is not what these tests are about. */
export function debounce<T extends (...args: never[]) => unknown>(fn: T): T {
	return fn;
}

/**
 * Stand-in for Obsidian's parseYaml, covering only the front matter shapes the tests use: a
 * top-level key, one nested map beneath it, `key: scalar`, and `key: [a, b]` flow lists.
 */
export function parseYaml(text: string): unknown {
	const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");
	const scalar = (value: string): unknown => {
		if (value.startsWith("[")) {
			return value
				.slice(1, -1)
				.split(",")
				.map(unquote)
				.filter((s) => s.length > 0);
		}
		if (value === "true") return true;
		if (value === "false") return false;
		return unquote(value);
	};
	const root: Record<string, unknown> = {};
	let section: Record<string, unknown> | null = null;
	for (const raw of text.split("\n")) {
		const match = /^(\s*)([\w-]+):\s*(.*)$/.exec(raw);
		if (!match) continue;
		const [, indent, key, value] = match;
		const target = indent ? section : root;
		if (!target) continue;
		if (value === "") {
			const child: Record<string, unknown> = {};
			target[key] = child;
			if (!indent) section = child;
		} else {
			target[key] = scalar(value);
		}
	}
	return root;
}
