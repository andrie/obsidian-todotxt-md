import { describe, it, expect } from "vitest";
import { parseTaskLine } from "../src/parse";
import { bumpPriority } from "../src/priority";

function task(raw: string) {
	const parsed = parseTaskLine(raw);
	if (!parsed) throw new Error("fixture line did not parse");
	return parsed;
}

describe("bumpPriority", () => {
	it("increasing from none jumps to default priority A", () => {
		const result = bumpPriority(task("- [ ] Call the bank"), -1);
		expect(result.priority).toBe("A");
	});

	it("increasing respects a configured default priority", () => {
		const result = bumpPriority(task("- [ ] Call the bank"), -1, "C");
		expect(result.priority).toBe("C");
	});

	it("increasing from A stays at A (already max urgency)", () => {
		const result = bumpPriority(task("- [ ] (A) Call the bank"), -1);
		expect(result.priority).toBe("A");
	});

	it("increasing from B moves to A", () => {
		const result = bumpPriority(task("- [ ] (B) Call the bank"), -1);
		expect(result.priority).toBe("A");
	});

	it("decreasing from none stays none", () => {
		const result = bumpPriority(task("- [ ] Call the bank"), 1);
		expect(result.priority).toBeNull();
	});

	it("decreasing from A moves to B", () => {
		const result = bumpPriority(task("- [ ] (A) Call the bank"), 1);
		expect(result.priority).toBe("B");
	});

	it("decreasing from Z clears priority to none", () => {
		const result = bumpPriority(task("- [ ] (Z) Call the bank"), 1);
		expect(result.priority).toBeNull();
	});

	it("does not mutate the input task", () => {
		const input = task("- [ ] (A) Call the bank");
		bumpPriority(input, 1);
		expect(input.priority).toBe("A");
	});
});
