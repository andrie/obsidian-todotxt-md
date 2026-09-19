import { describe, it, expect } from "vitest";
import { expandDateToken, type Clock } from "../src/dates";

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
