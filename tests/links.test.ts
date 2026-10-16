import { describe, it, expect } from "vitest";
import { splitWikilinks } from "../src/links";

describe("splitWikilinks", () => {
	it("returns a single text segment when there are no links", () => {
		expect(splitWikilinks("Call the bank")).toEqual([{ kind: "text", text: "Call the bank" }]);
	});

	it("returns no segments for empty text", () => {
		expect(splitWikilinks("")).toEqual([]);
	});

	it("turns [[Note]] into a link showing the note name", () => {
		expect(splitWikilinks("See [[Project plan]] now")).toEqual([
			{ kind: "text", text: "See " },
			{ kind: "link", target: "Project plan", display: "Project plan" },
			{ kind: "text", text: " now" },
		]);
	});

	it("shows the alias for [[Note|alias]]", () => {
		expect(splitWikilinks("[[Project plan|the plan]]")).toEqual([
			{ kind: "link", target: "Project plan", display: "the plan" },
		]);
	});

	it("keeps the heading in the target and shows 'Note > Heading'", () => {
		expect(splitWikilinks("[[Plan#Risks]]")).toEqual([
			{ kind: "link", target: "Plan#Risks", display: "Plan > Risks" },
		]);
	});

	it("handles block references", () => {
		expect(splitWikilinks("[[Plan#^abc123]]")).toEqual([
			{ kind: "link", target: "Plan#^abc123", display: "Plan > ^abc123" },
		]);
	});

	it("handles several links in one line", () => {
		const segments = splitWikilinks("[[A]] and [[B|bee]]");
		expect(segments.filter((s) => s.kind === "link")).toHaveLength(2);
		expect(segments[1]).toEqual({ kind: "text", text: " and " });
	});

	it("leaves an unclosed [[ as text", () => {
		expect(splitWikilinks("broken [[link here")).toEqual([
			{ kind: "text", text: "broken [[link here" },
		]);
	});

	it("leaves an empty [[]] as text", () => {
		expect(splitWikilinks("x [[]] y")).toEqual([{ kind: "text", text: "x [[]] y" }]);
	});

	it("leaves embeds ![[...]] as literal text", () => {
		expect(splitWikilinks("see ![[image.png]] here")).toEqual([
			{ kind: "text", text: "see ![[image.png]] here" },
		]);
	});
});
