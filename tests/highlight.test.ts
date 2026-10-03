import { describe, expect, it } from "vitest";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { computeLineDecorations, type PendingDecoration } from "../src/highlight";

/**
 * Mirrors buildDecorations' own sort-then-add sequence (src/highlight.ts) so these tests
 * exercise the exact invariant that matters: RangeSetBuilder.add requires non-decreasing `from`
 * (and ties broken with line-decorations first). computeLineDecorations alone returns
 * position-unsorted entries by design (the main span loop, the lowercase-priority check, and
 * the malformed-priority check are logically independent passes) — sorting is the caller's
 * responsibility, so these tests prove the sort actually prevents the documented crash rather
 * than merely asserting computeLineDecorations's own output shape.
 */
function buildFromPending(pending: PendingDecoration[]): void {
	const builder = new RangeSetBuilder<Decoration>();
	const sorted = [...pending].sort(
		(a, b) => a.from - b.from || (a.isLine === b.isLine ? 0 : a.isLine ? -1 : 1),
	);
	for (const { from, to, decoration } of sorted) {
		builder.add(from, to, decoration);
	}
	builder.finish();
}

describe("computeLineDecorations ordering", () => {
	it("does not crash on a lowercase leading priority followed by a later-positioned token", () => {
		const line = "- [ ] (a) 2026-10-10 Buy milk +Home";
		const pending = computeLineDecorations(line, 0);

		// Sanity: the crash-triggering shape is actually present (not just "no entries").
		expect(
			pending.some((p) => p.decoration.spec.class === "todotxt-md-hl-priority-lowercase"),
		).toBe(true);
		expect(pending.some((p) => p.decoration.spec.class === "todotxt-md-hl-date")).toBe(true);

		expect(() => buildFromPending(pending)).not.toThrow();
	});

	it("does not crash on a malformed leading priority followed by a trailing +project", () => {
		const line = "- [ ] [A] Buy milk +Home";
		const pending = computeLineDecorations(line, 0);

		expect(() => buildFromPending(pending)).not.toThrow();
	});

	it("still decorates the trailing +project when the leading priority is malformed", () => {
		const line = "- [ ] [A] Buy milk +Home";
		const pending = computeLineDecorations(line, 0);

		const projectMark = pending.find(
			(p) => !p.isLine && typeof p.decoration.spec.attributes?.style === "string",
		);
		expect(projectMark).toBeDefined();
		expect(projectMark?.decoration.spec.attributes.style).toContain("color:");

		const malformedMark = pending.find(
			(p) => p.decoration.spec.class === "todotxt-md-hl-priority-malformed",
		);
		expect(malformedMark).toBeDefined();

		// Confirm it is genuinely present in the final, built decoration set (not just the
		// pending array) by building and re-reading it back out of the RangeSet.
		const builder = new RangeSetBuilder<Decoration>();
		const sorted = [...pending].sort(
			(a, b) => a.from - b.from || (a.isLine === b.isLine ? 0 : a.isLine ? -1 : 1),
		);
		for (const { from, to, decoration } of sorted) {
			builder.add(from, to, decoration);
		}
		const rangeSet = builder.finish();

		const seenStyles: string[] = [];
		rangeSet.between(0, line.length, (_from, _to, value) => {
			const style = value.spec.attributes?.style;
			if (typeof style === "string") seenStyles.push(style);
		});
		expect(seenStyles.some((s) => s.includes("color:"))).toBe(true);
	});

	it("still skips coloring a valid uppercase priority and keeps date/project tokens", () => {
		const line = "- [ ] (A) 2026-10-10 Call the bank +Finance #calls due:2026-10-25";
		const pending = computeLineDecorations(line, 0);

		expect(
			pending.some((p) => p.decoration.spec.class === "todotxt-md-hl-priority-lowercase"),
		).toBe(false);
		expect(
			pending.some((p) => p.decoration.spec.class === "todotxt-md-hl-priority-malformed"),
		).toBe(false);
		expect(pending.filter((p) => p.decoration.spec.class === "todotxt-md-hl-date")).toHaveLength(2);
		expect(() => buildFromPending(pending)).not.toThrow();
	});

	it("keeps the done-line decoration and a per-token project mark both present without crashing", () => {
		const line = "- [x] 2026-10-01 Renewed passport +Admin";
		const pending = computeLineDecorations(line, 0);

		expect(
			pending.some((p) => p.isLine && p.decoration.spec.class === "todotxt-md-hl-done-line"),
		).toBe(true);
		expect(
			pending.some((p) => !p.isLine && typeof p.decoration.spec.attributes?.style === "string"),
		).toBe(true);
		expect(() => buildFromPending(pending)).not.toThrow();
	});
});
