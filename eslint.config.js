// @ts-check
import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";

export default [
	js.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				sourceType: "module",
			},
			globals: {
				HTMLElement: "readonly",
				MouseEvent: "readonly",
				KeyboardEvent: "readonly",
			},
		},
		plugins: {
			"@typescript-eslint": tseslint,
		},
		rules: {
			...tseslint.configs.recommended.rules,
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
		},
	},
	{
		// Pure core modules are the grammar's single source of truth (see DESIGN_RULES.md
		// section 4.1) — `any` here defeats the point of a typed Task model, so it's a
		// build-time error rather than an honor-system rule.
		files: ["src/parse.ts", "src/priority.ts", "src/dates.ts", "src/sort.ts", "src/aggregate.ts"],
		rules: {
			"@typescript-eslint/no-explicit-any": "error",
		},
	},
	{
		files: ["**/*.mjs"],
		languageOptions: {
			globals: {
				process: "readonly",
				console: "readonly",
			},
		},
	},
	{
		ignores: ["main.js", "node_modules/**"],
	},
	prettier,
];
