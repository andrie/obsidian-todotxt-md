import { describe, it, expect } from "vitest";
import { splitFrontmatter, parseNoteMeta, readNoteMeta } from "../src/noteMeta";

describe("splitFrontmatter", () => {
	it("returns the text between the leading --- lines", () => {
		expect(splitFrontmatter("---\na: 1\nb: 2\n---\nbody")).toBe("a: 1\nb: 2");
	});

	it("returns null when the note does not start with ---", () => {
		expect(splitFrontmatter("body\n---\na: 1\n---")).toBeNull();
	});

	it("returns null when there is no closing ---", () => {
		expect(splitFrontmatter("---\na: 1\n- [ ] task")).toBeNull();
	});

	it("handles Windows line endings", () => {
		expect(splitFrontmatter("---\r\na: 1\r\n---\r\nbody")).toBe("a: 1");
	});

	it("tolerates a leading byte-order mark", () => {
		expect(splitFrontmatter("﻿---\na: 1\n---\n")).toBe("a: 1");
	});

	it("returns an empty string for an empty block", () => {
		expect(splitFrontmatter("---\n---\n")).toBe("");
	});
});

describe("parseNoteMeta", () => {
	const empty = { ignore: false, projects: [], contexts: [] };

	it("returns the empty default for non-objects and a missing or non-map todotxt key", () => {
		expect(parseNoteMeta(undefined)).toEqual(empty);
		expect(parseNoteMeta(null)).toEqual(empty);
		expect(parseNoteMeta("text")).toEqual(empty);
		expect(parseNoteMeta({})).toEqual(empty);
		expect(parseNoteMeta({ todotxt: "ignore" })).toEqual(empty);
		expect(parseNoteMeta({ todotxt: ["ignore"] })).toEqual(empty);
	});

	it("reads ignore: true and the string 'true' in any case", () => {
		expect(parseNoteMeta({ todotxt: { ignore: true } }).ignore).toBe(true);
		expect(parseNoteMeta({ todotxt: { ignore: "TRUE" } }).ignore).toBe(true);
		expect(parseNoteMeta({ todotxt: { ignore: " true " } }).ignore).toBe(true);
	});

	it("treats any other ignore value as false", () => {
		expect(parseNoteMeta({ todotxt: { ignore: false } }).ignore).toBe(false);
		expect(parseNoteMeta({ todotxt: { ignore: "yes" } }).ignore).toBe(false);
		expect(parseNoteMeta({ todotxt: { ignore: 1 } }).ignore).toBe(false);
	});

	it("strips an optional + from projects", () => {
		const meta = parseNoteMeta({ todotxt: { projects: ["alpha", "+beta"] } });
		expect(meta.projects).toEqual(["alpha", "beta"]);
	});

	it("gives bare contexts the @ prefix and keeps an explicit # or @", () => {
		const meta = parseNoteMeta({ todotxt: { contexts: ["home", "@work", "#errand"] } });
		expect(meta.contexts).toEqual([
			{ name: "home", prefix: "@" },
			{ name: "work", prefix: "@" },
			{ name: "errand", prefix: "#" },
		]);
	});

	it("accepts a single string instead of a list", () => {
		const meta = parseNoteMeta({ todotxt: { projects: "+solo", contexts: "home" } });
		expect(meta.projects).toEqual(["solo"]);
		expect(meta.contexts).toEqual([{ name: "home", prefix: "@" }]);
	});

	it("accepts YAML numbers as names", () => {
		const meta = parseNoteMeta({ todotxt: { projects: [2026], contexts: [42] } });
		expect(meta.projects).toEqual(["2026"]);
		expect(meta.contexts).toEqual([{ name: "42", prefix: "@" }]);
	});

	it("drops empty, whitespace-containing and non-scalar entries", () => {
		const meta = parseNoteMeta({
			todotxt: { projects: ["", "+", "two words", { a: 1 }, null, "ok"], contexts: ["@", " "] },
		});
		expect(meta.projects).toEqual(["ok"]);
		expect(meta.contexts).toEqual([]);
	});

	it("collapses duplicates", () => {
		const meta = parseNoteMeta({
			todotxt: { projects: ["a", "+a", "a"], contexts: ["x", "@x", "#x"] },
		});
		expect(meta.projects).toEqual(["a"]);
		expect(meta.contexts).toEqual([
			{ name: "x", prefix: "@" },
			{ name: "x", prefix: "#" },
		]);
	});

	it("ignores a non-list, non-string projects value", () => {
		expect(parseNoteMeta({ todotxt: { projects: { a: 1 } } }).projects).toEqual([]);
	});
});

describe("readNoteMeta", () => {
	const fakeYaml = (text: string): unknown => JSON.parse(text);

	it("parses the front matter block with the injected parser", () => {
		const content = '---\n{"todotxt": {"ignore": true}}\n---\n- [ ] task';
		expect(readNoteMeta(content, fakeYaml).ignore).toBe(true);
	});

	it("returns the empty default when there is no front matter", () => {
		expect(readNoteMeta("- [ ] task", fakeYaml)).toEqual({
			ignore: false,
			projects: [],
			contexts: [],
		});
	});

	it("returns the empty default (not ignored) when the parser throws", () => {
		const meta = readNoteMeta("---\nnot json\n---\n", fakeYaml);
		expect(meta).toEqual({ ignore: false, projects: [], contexts: [] });
	});
});
