import { describe, it, expect } from "vitest";
import { parseTaskLine, serializeTask } from "../src/parse";
import { fixtures } from "./fixtures/tasks";

describe("parseTaskLine", () => {
	it("returns null for non-checkbox lines", () => {
		expect(parseTaskLine("Call the bank")).toBeNull();
		expect(parseTaskLine("# A heading")).toBeNull();
		expect(parseTaskLine("")).toBeNull();
	});

	for (const fixture of fixtures) {
		it(`parses: ${fixture.name}`, () => {
			expect(parseTaskLine(fixture.raw)).toEqual(fixture.parsed);
		});
	}

	it("preserves leading indentation", () => {
		const task = parseTaskLine("  - [ ] Nested task");
		expect(task?.indent).toBe("  ");
	});
});

describe("serializeTask", () => {
	for (const fixture of fixtures.filter((f) => !f.skipRoundTrip)) {
		it(`round-trips (semantically): ${fixture.name}`, () => {
			const serialized = serializeTask(fixture.parsed);
			expect(parseTaskLine(serialized)).toEqual(fixture.parsed);
		});
	}

	it("serializes the duplicate-due: fixture using canonical token order", () => {
		// Known grammar ambiguity (see Fixture.skipRoundTrip): the literal "due:2026-09-30"
		// lives inside `description`, so canonical serialization places it before the
		// structured `due:` field — reordering relative to the original raw text is expected
		// here (DESIGN_RULES.md section 2.3: canonical order is enforced on rewrite). What's
		// NOT expected is data loss: both due:-shaped tokens must still be present afterward,
		// and re-parsing can no longer tell them apart (the accepted ambiguity).
		const fixture = fixtures.find((f) => f.skipRoundTrip);
		if (!fixture) throw new Error("expected a skipRoundTrip fixture to exist");

		const serialized = serializeTask(fixture.parsed);
		expect(serialized).toBe("- [ ] Call the bank due:2026-09-30 due:2026-09-25");

		const reparsed = parseTaskLine(serialized);
		expect(reparsed?.due).toBe("2026-09-30");
		expect(reparsed?.description).toBe("Call the bank due:2026-09-25");
	});
});
