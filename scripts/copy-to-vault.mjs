// Fallback dev-loop step for when symlinking the vault plugin folder isn't available
// (Developer Mode off, non-elevated shell — see PLAN.md "Deployment / dev loop").
// Usage: set TODOTXT_MD_VAULT_PLUGIN_DIR to the vault's plugin folder, then run this
// after each build. Loses true hot-reload-on-save but unblocks setup without elevation.
import { copyFile, mkdir } from "fs/promises";
import { existsSync } from "fs";

const dest = process.env.TODOTXT_MD_VAULT_PLUGIN_DIR;

if (!dest) {
	console.error(
		"Set TODOTXT_MD_VAULT_PLUGIN_DIR to <vault>/.obsidian/plugins/todotxt-md before running dev:copy.",
	);
	process.exit(1);
}

if (!existsSync(dest)) {
	await mkdir(dest, { recursive: true });
}

const files = ["main.js", "manifest.json", "styles.css"];

for (const file of files) {
	if (existsSync(file)) {
		await copyFile(file, `${dest}/${file}`);
		console.log(`Copied ${file} -> ${dest}/${file}`);
	}
}
