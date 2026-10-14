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
