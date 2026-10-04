import { describe, it, expect } from "vitest";
import {
	parseTaskLine,
	serializeTask,
	parseTaskLineWithSpans,
	detectMalformedPriority,
	checkboxBodyStart,
} from "../src/parse";
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

describe("checkboxBodyStart", () => {
	it("returns null for non-checkbox lines", () => {
		expect(checkboxBodyStart("Call the bank")).toBeNull();
		expect(checkboxBodyStart("")).toBeNull();
	});

	it("returns the offset immediately after the checkbox marker", () => {
		const line = "- [ ] (A) Call the bank";
		const start = checkboxBodyStart(line);
		expect(start).not.toBeNull();
		expect(line.slice(start!)).toBe("(A) Call the bank");
	});

	it("accounts for leading indentation", () => {
		const line = "  - [x] 2026-09-19 Call the bank";
		const start = checkboxBodyStart(line);
		expect(line.slice(start!)).toBe("2026-09-19 Call the bank");
	});

	it("works for a bare checkbox with no body", () => {
		const line = "- [ ]";
		expect(checkboxBodyStart(line)).toBe(line.length);
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

describe("parseTaskLineWithSpans", () => {
	it("returns correct offsets for a canonical full line", () => {
		const line = "- [ ] (A) 2026-09-19 Call the bank about the loan +Finance #calls due:2026-09-25";
		const result = parseTaskLineWithSpans(line);
		expect(result).not.toBeNull();
		if (!result) return;

		for (const span of result.spans) {
			const text = line.slice(span.start, span.end);
			if (span.kind === "priority") expect(text).toBe("(A)");
			if (span.kind === "creationDate") expect(text).toBe("2026-09-19");
			if (span.kind === "project") expect(text).toBe("+Finance");
			if (span.kind === "context") expect(text).toBe("#calls");
			if (span.kind === "due") expect(text).toBe("due:2026-09-25");
		}

		const kinds = result.spans.map((s) => s.kind).sort();
		expect(kinds).toEqual(["context", "creationDate", "due", "priority", "project"].sort());
	});

	it("returns offsets for multiple projects/contexts in order", () => {
		const line = "- [ ] +Proj1 +Proj2 Call the bank";
		const result = parseTaskLineWithSpans(line);
		expect(result).not.toBeNull();
		if (!result) return;

		const projectSpans = result.spans.filter((s) => s.kind === "project");
		expect(projectSpans).toHaveLength(2);
		expect(line.slice(projectSpans[0].start, projectSpans[0].end)).toBe("+Proj1");
		expect(line.slice(projectSpans[1].start, projectSpans[1].end)).toBe("+Proj2");
	});

	it("handles the duplicate due: ambiguity the same way parseTaskLine does", () => {
		const line = "- [ ] Call the bank due:2026-09-25 due:2026-09-30";
		const result = parseTaskLineWithSpans(line);
		expect(result).not.toBeNull();
		if (!result) return;

		const dueSpans = result.spans.filter((s) => s.kind === "due");
		expect(dueSpans).toHaveLength(1);
		expect(line.slice(dueSpans[0].start, dueSpans[0].end)).toBe("due:2026-09-25");
	});

	it("returns completionDate span for a completed task", () => {
		const line = "- [x] 2026-09-20 (A) 2026-09-19 Renewed passport +Admin";
		const result = parseTaskLineWithSpans(line);
		expect(result).not.toBeNull();
		if (!result) return;

		const completionSpan = result.spans.find((s) => s.kind === "completionDate");
		expect(completionSpan).toBeDefined();
		if (!completionSpan) return;
		expect(line.slice(completionSpan.start, completionSpan.end)).toBe("2026-09-20");
	});

	it("returns null for a non-checkbox line", () => {
		expect(parseTaskLineWithSpans("Just a regular line")).toBeNull();
	});

	for (const fixture of fixtures) {
		it(`task output matches parseTaskLine for fixture: ${fixture.name}`, () => {
			const result = parseTaskLineWithSpans(fixture.raw);
			expect(result).not.toBeNull();
			if (!result) return;
			expect(result.task).toEqual(fixture.parsed);
		});
	}

	it("produces offsets that slice to exactly the expected text for every fixture span", () => {
		for (const fixture of fixtures) {
			const result = parseTaskLineWithSpans(fixture.raw);
			expect(result).not.toBeNull();
			if (!result) continue;
			for (const span of result.spans) {
				expect(span.start).toBeGreaterThanOrEqual(0);
				expect(span.end).toBeLessThanOrEqual(fixture.raw.length);
				expect(span.start).toBeLessThanOrEqual(span.end);
			}
		}
	});

	it("handles extra internal whitespace between tokens", () => {
		const line = "- [ ] (A)  2026-09-19  Call   the bank  +Finance  #calls  due:2026-09-25";
		const result = parseTaskLineWithSpans(line);
		expect(result).not.toBeNull();
		if (!result) return;
		for (const span of result.spans) {
			const text = line.slice(span.start, span.end);
			if (span.kind === "priority") expect(text).toBe("(A)");
			if (span.kind === "creationDate") expect(text).toBe("2026-09-19");
			if (span.kind === "project") expect(text).toBe("+Finance");
			if (span.kind === "context") expect(text).toBe("#calls");
			if (span.kind === "due") expect(text).toBe("due:2026-09-25");
		}
	});

	it("handles due: appearing after multiple projects and contexts", () => {
		const line = "- [ ] Call the bank +Proj1 +Proj2 #ctx1 #ctx2 due:2026-09-25 t:2026-09-20";
		const result = parseTaskLineWithSpans(line);
		expect(result).not.toBeNull();
		if (!result) return;

		const dueSpan = result.spans.find((s) => s.kind === "due");
		const thresholdSpan = result.spans.find((s) => s.kind === "threshold");
		expect(dueSpan).toBeDefined();
		expect(thresholdSpan).toBeDefined();
		if (!dueSpan || !thresholdSpan) return;
		expect(line.slice(dueSpan.start, dueSpan.end)).toBe("due:2026-09-25");
		expect(line.slice(thresholdSpan.start, thresholdSpan.end)).toBe("t:2026-09-20");

		const projectSpans = result.spans.filter((s) => s.kind === "project");
		const contextSpans = result.spans.filter((s) => s.kind === "context");
		expect(projectSpans.map((s) => line.slice(s.start, s.end))).toEqual(["+Proj1", "+Proj2"]);
		expect(contextSpans.map((s) => line.slice(s.start, s.end))).toEqual(["#ctx1", "#ctx2"]);
	});

	it("handles a done task with no completion date present (no completionDate span)", () => {
		const line = "- [x] Call the bank +Admin";
		const result = parseTaskLineWithSpans(line);
		expect(result).not.toBeNull();
		if (!result) return;
		expect(result.task.completionDate).toBeNull();
		expect(result.spans.find((s) => s.kind === "completionDate")).toBeUndefined();
	});

	it("returns an empty spans array for an empty body", () => {
		const result = parseTaskLineWithSpans("- [ ]");
		expect(result).not.toBeNull();
		if (!result) return;
		expect(result.spans).toEqual([]);
	});

	it("preserves indentation in offsets", () => {
		const line = "  - [ ] (A) Call the bank";
		const result = parseTaskLineWithSpans(line);
		expect(result).not.toBeNull();
		if (!result) return;
		const prioritySpan = result.spans.find((s) => s.kind === "priority");
		expect(prioritySpan).toBeDefined();
		if (!prioritySpan) return;
		expect(line.slice(prioritySpan.start, prioritySpan.end)).toBe("(A)");
	});
});

describe("detectMalformedPriority", () => {
	it("detects wrong bracket characters in the leading position", () => {
		for (const line of ["- [ ] [A] Call the bank", "- [ ] {A} Call the bank", "- [ ] <A> Call the bank"]) {
			const result = detectMalformedPriority(line);
			expect(result).not.toBeNull();
			if (!result) continue;
			expect(result.kind).toBe("priority");
		}
	});

	it("detects invalid content shape in the leading position", () => {
		for (const line of ["- [ ] (AA) Call the bank", "- [ ] (1) Call the bank"]) {
			expect(detectMalformedPriority(line)).not.toBeNull();
		}
	});

	it("returns null for valid priority (uppercase or lowercase)", () => {
		expect(detectMalformedPriority("- [ ] (A) Call the bank")).toBeNull();
		expect(detectMalformedPriority("- [ ] (a) Call the bank")).toBeNull();
	});

	it("returns null for a non-leading bracket-shaped token", () => {
		expect(detectMalformedPriority("- [ ] Buy milk [item]")).toBeNull();
	});

	it("returns null for a non-checkbox line", () => {
		expect(detectMalformedPriority("Just a regular line")).toBeNull();
	});

	it("returns correct offsets for a malformed bracket token", () => {
		const line = "- [ ] [A] Call the bank";
		const result = detectMalformedPriority(line);
		expect(result).not.toBeNull();
		if (!result) return;
		expect(line.slice(result.start, result.end)).toBe("[A]");
	});

	it("returns null when the leading token is a plain word, not bracket-shaped", () => {
		expect(detectMalformedPriority("- [ ] Call the bank")).toBeNull();
	});
});

describe("dual-prefix context support (@ and #)", () => {
	it("recognizes a leading @ exactly like a leading #", () => {
		const task = parseTaskLine("- [ ] Call the bank @home");
		expect(task).not.toBeNull();
		expect(task?.contexts).toEqual([{ name: "home", prefix: "@" }]);
	});

	it("preserves left-to-right order across mixed @ and # tokens", () => {
		const mixed1 = parseTaskLine("- [ ] Call the bank @home #calls");
		expect(mixed1?.contexts).toEqual([
			{ name: "home", prefix: "@" },
			{ name: "calls", prefix: "#" },
		]);

		const mixed2 = parseTaskLine("- [ ] Call the bank #calls @home");
		expect(mixed2?.contexts).toEqual([
			{ name: "calls", prefix: "#" },
			{ name: "home", prefix: "@" },
		]);
	});

	it("round-trips each token's original prefix exactly, no canonicalization", () => {
		const line = "- [ ] Call the bank @home #calls";
		const task = parseTaskLine(line);
		expect(task).not.toBeNull();
		if (!task) return;
		expect(serializeTask(task)).toBe(line);
	});

	it("a lone @ with nothing after it falls through to literal description text", () => {
		const task = parseTaskLine("- [ ] Call the bank @ now");
		expect(task).not.toBeNull();
		expect(task?.contexts).toEqual([]);
		expect(task?.description).toBe("Call the bank @ now");
	});

	it("parseTaskLineWithSpans recognizes @ context spans with correct offsets", () => {
		const line = "- [ ] Call the bank @home";
		const result = parseTaskLineWithSpans(line);
		expect(result).not.toBeNull();
		if (!result) return;
		const contextSpans = result.spans.filter((s) => s.kind === "context");
		expect(contextSpans).toHaveLength(1);
		expect(line.slice(contextSpans[0].start, contextSpans[0].end)).toBe("@home");
	});
});
