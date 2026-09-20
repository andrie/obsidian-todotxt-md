import { describe, it, expect } from "vitest";
import { expandDateToken, suggestDateShortcuts, type Clock } from "../src/dates";

// Fixed clock: Saturday 2026-09-19 (matches CLAUDE.md's stated "today").
const fixedClock: Clock = () => new Date(2026, 8, 19);

describe("expandDateToken", () => {
	it("expands tod to today", () => {
		expect(expandDateToken("tod", fixedClock)).toBe("2026-09-19");
	});

	it("expands tom to tomorrow", () => {
		expect(expandDateToken("tom", fixedClock)).toBe("2026-09-20");
	});

	it("expands a weekday token to the next occurrence", () => {
		// today is Saturday; "mon" should be 2026-09-21
		expect(expandDateToken("mon", fixedClock)).toBe("2026-09-21");
	});

	it("expands the same weekday as today to next week, not today", () => {
		// today is Saturday; "sat" should roll to next Saturday, not today
		expect(expandDateToken("sat", fixedClock)).toBe("2026-09-26");
	});

	it("expands relative day offsets", () => {
		expect(expandDateToken("+3d", fixedClock)).toBe("2026-09-22");
	});

	it("expands relative week offsets", () => {
		expect(expandDateToken("+1w", fixedClock)).toBe("2026-09-26");
	});

	it("is case-insensitive", () => {
		expect(expandDateToken("TOD", fixedClock)).toBe("2026-09-19");
	});

	it("returns null for unrecognized tokens", () => {
		expect(expandDateToken("banana", fixedClock)).toBeNull();
		expect(expandDateToken("2026-09-19", fixedClock)).toBeNull();
	});

	it("handles month/year rollover", () => {
		const endOfMonth: Clock = () => new Date(2026, 8, 30);
		expect(expandDateToken("tom", endOfMonth)).toBe("2026-10-01");
	});
});

describe("suggestDateShortcuts", () => {
	it("returns all 9 shortcuts for an empty partial, in a fixed order", () => {
		const results = suggestDateShortcuts("", fixedClock);
		expect(results.map((r) => r.token)).toEqual([
			"tod",
			"tom",
			"sun",
			"mon",
			"tue",
			"wed",
			"thu",
			"fri",
			"sat",
		]);
	});

	it("each empty-partial suggestion resolves to the same ISO date expandDateToken gives", () => {
		const results = suggestDateShortcuts("", fixedClock);
		for (const r of results) {
			if (r.iso !== null) {
				expect(r.iso).toBe(expandDateToken(r.token, fixedClock));
			}
		}
	});

	it('narrows to "tod", "tom", "tue", and "thu" for partial "t"', () => {
		// Every shortcut token starting with "t": tod, tom, tue, thu.
		const results = suggestDateShortcuts("t", fixedClock);
		expect(results.map((r) => r.token).sort()).toEqual(["thu", "tod", "tom", "tue"]);
	});

	it('narrows to exactly "tod" for partial "tod"', () => {
		const results = suggestDateShortcuts("tod", fixedClock);
		expect(results.map((r) => r.token)).toEqual(["tod"]);
		expect(results[0].iso).toBe("2026-09-19");
	});

	it('narrows to "mon" only for partial "m"', () => {
		const results = suggestDateShortcuts("m", fixedClock);
		expect(results.map((r) => r.token)).toEqual(["mon"]);
		expect(results[0].iso).toBe("2026-09-21");
	});

	it('returns an unresolved hint entry for partial "+"', () => {
		const results = suggestDateShortcuts("+", fixedClock);
		expect(results).toHaveLength(1);
		expect(results[0].iso).toBeNull();
	});

	it('returns an unresolved hint entry for an incomplete partial "+3"', () => {
		const results = suggestDateShortcuts("+3", fixedClock);
		expect(results).toHaveLength(1);
		expect(results[0].iso).toBeNull();
	});

	it('resolves a complete relative-offset partial "+3d"', () => {
		const results = suggestDateShortcuts("+3d", fixedClock);
		expect(results).toHaveLength(1);
		expect(results[0].iso).toBe("2026-09-22");
	});

	it("returns an empty array for an unmatched partial", () => {
		expect(suggestDateShortcuts("xyz", fixedClock)).toEqual([]);
		expect(suggestDateShortcuts("banana", fixedClock)).toEqual([]);
	});

	it("is case-insensitive", () => {
		const results = suggestDateShortcuts("TOD", fixedClock);
		expect(results.map((r) => r.token)).toEqual(["tod"]);
	});
});
