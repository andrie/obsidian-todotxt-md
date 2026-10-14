import { App, Plugin, TAbstractFile, TFile, debounce } from "obsidian";
import { extractFileVocab, mergeVocab, isInScanFolders, type FileVocab } from "./vocab";

/**
 * Plugin-owned cache of the vault's +project / @place / #tag names. The aggregated view's own
 * scan is private to the view and only exists while it is open, so the inline popup cannot
 * reuse it. First use scans the vault (honouring `scanFolders`); afterwards vault events update
 * single files, debounced.
 */
export class VocabIndex {
	private readonly perFile = new Map<string, FileVocab>();
	private merged: FileVocab | null = null;
	private building: Promise<void> | null = null;
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
		this.perFile.clear();
		this.merged = null;
		this.building = null;
	}

	async get(): Promise<FileVocab> {
		if (!this.building) this.building = this.build();
		await this.building;
		if (!this.merged) this.merged = mergeVocab(this.perFile.values());
		return this.merged;
	}

	private async build(): Promise<void> {
		const folders = this.getScanFolders();
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (isInScanFolders(file.path, folders)) await this.index(file);
		}
	}

	private async index(file: TFile): Promise<void> {
		const content = await this.app.vault.cachedRead(file);
		this.perFile.set(file.path, extractFileVocab(content.split("\n")));
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
