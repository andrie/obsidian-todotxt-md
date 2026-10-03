import { describe, expect, it } from "vitest";
import { nameToColor } from "../src/tokenColors";

describe("nameToColor", () => {
	it("is deterministic for the same name", () => {
		expect(nameToColor("Finance")).toBe(nameToColor("Finance"));
		expect(nameToColor("calls")).toBe(nameToColor("calls"));
	});

	it("returns a hex color string", () => {
		expect(nameToColor("Finance")).toMatch(/^#[0-9A-Fa-f]{6}$/);
	});

	it("spreads across more than one palette slot for distinct names", () => {
		const names = [
			"Finance",
			"Errands",
			"calls",
			"Admin",
			"Home",
			"Work",
			"Health",
			"Travel",
			"Shopping",
			"Family",
		];
		const colors = new Set(names.map(nameToColor));
		expect(colors.size).toBeGreaterThan(1);
	});

	it("does not throw on empty string or unicode names", () => {
		expect(() => nameToColor("")).not.toThrow();
		expect(nameToColor("")).toMatch(/^#[0-9A-Fa-f]{6}$/);
		expect(() => nameToColor("日本語")).not.toThrow();
		expect(() => nameToColor("café")).not.toThrow();
	});
});
