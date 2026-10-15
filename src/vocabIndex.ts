import { App, Plugin, TAbstractFile, TFile, debounce, parseYaml } from "obsidian";
import {
	adjustVocab,
	extractNoteVocab,
	mergeVocab,
	isInScanFolders,
	type FileVocab,
} from "./vocab";
import { readNoteMeta } from "./noteMeta";

/** The note open in the editor: its live lines supersede its (autosave-lagged) cached entry. */
export interface ActiveNote {
	path: string;
	lines: string[];
}

/**
 * Plugin-owned cache of the vault's +project / @place / #tag names. The aggregated view's own
 * scan is private to the view and only exists while it is open, so the inline popup cannot
 * reuse it. First use scans the vault (honouring `scanFolders`); afterwards vault events update
 * single files, debounced. A scan that was in flight when `invalidate()` ran notices (via the
 * generation counter) and stops, so it can never repopulate the cache with stale scope.
 */
export class VocabIndex {
	private readonly perFile = new Map<string, FileVocab>();
	private merged: FileVocab | null = null;
	private building: Promise<void> | null = null;
	private generation = 0;
	private readonly pending = new Set<string>();

	private readonly flush = debounce(
		() => {
			void this.flushPending();
		},
		500,
		true,
	);

	constructor(
		private readonly app: App,
		private readonly getScanFolders: () => string[],
	) {}

	register(plugin: Plugin): void {
		plugin.registerEvent(this.app.vault.on("modify", (file) => this.queue(file)));
		plugin.registerEvent(this.app.vault.on("create", (file) => this.queue(file)));
		plugin.registerEvent(this.app.vault.on("delete", (file) => this.drop(file.path)));
		plugin.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.drop(oldPath);
				this.queue(file);
			}),
		);
	}

	/** Forget everything; the next get() rescans (used when `scanFolders` changes). */
	invalidate(): void {
		this.generation++;
		this.perFile.clear();
		this.merged = null;
		this.building = null;
	}

	/**
	 * The vault vocabulary. When `active` is given, that note's cached contribution is replaced
	 * by its live lines (callers exclude the line being typed), so half-typed tokens that
	 * autosave already wrote to disk are not offered back.
	 */
	async get(active?: ActiveNote): Promise<FileVocab> {
		if (!this.building) this.building = this.build(this.generation);
		const building = this.building;
		try {
			await building;
		} catch {
			// A failed scan must not be cached: let the next call retry.
			if (this.building === building) this.building = null;
		}
		if (!this.merged) this.merged = mergeVocab(this.perFile.values());
		if (!active) return this.merged;
		const live = extractNoteVocab(readNoteMeta(active.lines.join("\n"), parseYaml), active.lines);
		return adjustVocab(this.merged, this.perFile.get(active.path), live);
	}

	private async build(generation: number): Promise<void> {
		const folders = this.getScanFolders();
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (generation !== this.generation) return;
			if (isInScanFolders(file.path, folders)) await this.index(file, generation);
		}
	}

	/** Reads and indexes one file; an unreadable file is skipped rather than failing the scan. */
	private async index(file: TFile, generation = this.generation): Promise<void> {
		let content: string;
		try {
			content = await this.app.vault.cachedRead(file);
		} catch {
			return;
		}
		if (generation !== this.generation) return;
		const lines = content.split("\n");
		this.perFile.set(file.path, extractNoteVocab(readNoteMeta(content, parseYaml), lines));
		this.merged = null;
	}

	private queue(file: TAbstractFile): void {
		if (!(file instanceof TFile) || file.extension !== "md") return;
		this.pending.add(file.path);
		this.flush();
	}

	private drop(path: string): void {
		this.pending.delete(path);
		if (this.perFile.delete(path)) this.merged = null;
	}

	private async flushPending(): Promise<void> {
		const paths = [...this.pending];
		this.pending.clear();
		const folders = this.getScanFolders();
		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile && isInScanFolders(path, folders)) {
				await this.index(file);
			} else {
				this.drop(path);
			}
		}
	}
}
