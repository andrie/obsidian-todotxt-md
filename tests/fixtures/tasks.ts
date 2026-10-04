import type { Task } from "../../src/parse";

/**
 * Shared ground truth for parse/serialize round-trip tests. Covers the parse-leniency
 * table in SPEC.md — canonical lines, malformed input, multi-project/context, completion.
 * parse.test.ts and sort.test.ts both import from here so fixtures can't drift apart.
 */
export interface Fixture {
	name: string;
	raw: string;
	parsed: Task;
	/**
	 * Set for fixtures where the *raw* text contains a literal token (e.g. a second
	 * "due:2026-09-30" left over from a duplicate) that is indistinguishable, on a second
	 * parse, from a structured field. serializeTask reproduces the raw text faithfully, but
	 * re-parsing that text will re-collide by construction — this is an inherent grammar
	 * ambiguity (which "due:"-shaped token is "the field" vs. "literal text" isn't knowable
	 * from the string alone), not a bug in parse or serialize. Excluded from the
	 * serialize-then-reparse assertion in parse.test.ts.
	 */
	skipRoundTrip?: boolean;
}

export const fixtures: Fixture[] = [
	{
		name: "canonical full line",
		raw: "- [ ] (A) 2026-09-19 Call the bank about the loan +Finance #calls due:2026-09-25",
		parsed: {
			indent: "",
			done: false,
			completionDate: null,
			priority: "A",
			creationDate: "2026-09-19",
			description: "Call the bank about the loan",
			projects: ["Finance"],
			contexts: [{ name: "calls", prefix: "#" }],
			due: "2026-09-25",
			threshold: null,
		},
	},
	{
		name: "completed task preserves priority/creation date",
		raw: "- [x] 2026-09-20 (A) 2026-09-19 Renewed passport +Admin",
		parsed: {
			indent: "",
			done: true,
			completionDate: "2026-09-20",
			priority: "A",
			creationDate: "2026-09-19",
			description: "Renewed passport",
			projects: ["Admin"],
			contexts: [],
			due: null,
			threshold: null,
		},
	},
	{
		name: "plain task, no metadata",
		raw: "- [ ] Call the bank",
		parsed: {
			indent: "",
			done: false,
			completionDate: null,
			priority: null,
			creationDate: null,
			description: "Call the bank",
			projects: [],
			contexts: [],
			due: null,
			threshold: null,
		},
	},
	{
		name: "out-of-position priority-looking text stays literal",
		raw: "- [ ] Call (A) the bank",
		parsed: {
			indent: "",
			done: false,
			completionDate: null,
			priority: null,
			creationDate: null,
			description: "Call (A) the bank",
			projects: [],
			contexts: [],
			due: null,
			threshold: null,
		},
	},
	{
		name: "second priority-looking token left as literal text",
		raw: "- [ ] (A) (B) Call the bank",
		parsed: {
			indent: "",
			done: false,
			completionDate: null,
			priority: "A",
			creationDate: null,
			description: "(B) Call the bank",
			projects: [],
			contexts: [],
			due: null,
			threshold: null,
		},
	},
	{
		name: "duplicate due: keeps first, second stays literal",
		raw: "- [ ] Call the bank due:2026-09-25 due:2026-09-30",
		skipRoundTrip: true,
		parsed: {
			indent: "",
			done: false,
			completionDate: null,
			priority: null,
			creationDate: null,
			description: "Call the bank due:2026-09-30",
			projects: [],
			contexts: [],
			due: "2026-09-25",
			threshold: null,
		},
	},
	{
		name: "multiple projects and contexts preserved in order",
		raw: "- [ ] +Proj1 +Proj2 Call the bank",
		parsed: {
			indent: "",
			done: false,
			completionDate: null,
			priority: null,
			creationDate: null,
			description: "Call the bank",
			projects: ["Proj1", "Proj2"],
			contexts: [],
			due: null,
			threshold: null,
		},
	},
	{
		name: "non-ISO date left as literal text",
		raw: "- [ ] due:2026-9-5 Call the bank",
		parsed: {
			indent: "",
			done: false,
			completionDate: null,
			priority: null,
			creationDate: null,
			description: "due:2026-9-5 Call the bank",
			projects: [],
			contexts: [],
			due: null,
			threshold: null,
		},
	},
	{
		name: "empty body still parses",
		raw: "- [ ]",
		parsed: {
			indent: "",
			done: false,
			completionDate: null,
			priority: null,
			creationDate: null,
			description: "",
			projects: [],
			contexts: [],
			due: null,
			threshold: null,
		},
	},
	{
		name: "mixed @ and # context prefixes preserved in order",
		raw: "- [ ] Call the bank @home #calls",
		parsed: {
			indent: "",
			done: false,
			completionDate: null,
			priority: null,
			creationDate: null,
			description: "Call the bank",
			projects: [],
			contexts: [
				{ name: "home", prefix: "@" },
				{ name: "calls", prefix: "#" },
			],
			due: null,
			threshold: null,
		},
	},
];
