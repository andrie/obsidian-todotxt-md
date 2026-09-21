import { Plugin, PluginSettingTab, Setting, App } from "obsidian";
import {
	bumpPriorityAtCursor,
	expandDateTokenAtCursor,
	sortBlockAtCursor,
	toggleDoneAtCursor,
} from "./editor";
import { DateShortcutSuggest } from "./dateSuggest";
import { AggregatedTaskView, TASK_VIEW_TYPE } from "./view";
import type { DueWindow } from "./aggregate";
import type { Clock } from "./dates";

interface TodotxtMdSettings {
	defaultPriority: string;
	enableDateSuggest: boolean;
	scanFolders: string[];
	defaultDueWindow: DueWindow;
}

const DEFAULT_SETTINGS: TodotxtMdSettings = {
	defaultPriority: "A",
	enableDateSuggest: true,
	scanFolders: [],
	defaultDueWindow: "all",
};

function isValidPriority(value: unknown): value is string {
	return typeof value === "string" && /^[A-Z]$/.test(value);
}

const VALID_DUE_WINDOWS: DueWindow[] = ["all", "overdue", "today", "this-week", "none"];

function isValidDueWindow(value: unknown): value is DueWindow {
	return typeof value === "string" && (VALID_DUE_WINDOWS as string[]).includes(value);
}

function isValidScanFolders(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

const systemClock: Clock = () => new Date();

export default class TodotxtMdPlugin extends Plugin {
	settings: TodotxtMdSettings = DEFAULT_SETTINGS;
	dateSuggest!: DateShortcutSuggest;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.dateSuggest = new DateShortcutSuggest(this.app, systemClock);
		this.dateSuggest.setEnabled(this.settings.enableDateSuggest);
		this.registerEditorSuggest(this.dateSuggest);

		this.registerView(TASK_VIEW_TYPE, (leaf) => new AggregatedTaskView(leaf, this));

		this.addCommand({
			id: "open-aggregated-view",
			name: "Open aggregated task view",
			callback: () => this.activateTaskView(),
		});

		this.addCommand({
			id: "increase-priority",
			name: "Increase priority",
			editorCallback: (editor) =>
				bumpPriorityAtCursor(editor, -1, this.settings.defaultPriority),
		});

		this.addCommand({
			id: "decrease-priority",
			name: "Decrease priority",
			editorCallback: (editor) =>
				bumpPriorityAtCursor(editor, 1, this.settings.defaultPriority),
		});

		this.addCommand({
			id: "expand-date-token",
			name: "Expand date token",
			editorCallback: (editor) => expandDateTokenAtCursor(editor, systemClock),
		});

		this.addCommand({
			id: "sort-current-block",
			name: "Sort current checkbox block",
			editorCallback: (editor) => sortBlockAtCursor(editor),
		});

		this.addCommand({
			id: "toggle-done",
			name: "Toggle done",
			editorCallback: (editor) => toggleDoneAtCursor(editor, systemClock),
		});

		this.addSettingTab(new TodotxtMdSettingTab(this.app, this));
	}

	async loadSettings(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<TodotxtMdSettings> | null;
		this.settings = {
			defaultPriority:
				loaded && isValidPriority(loaded.defaultPriority)
					? loaded.defaultPriority
					: DEFAULT_SETTINGS.defaultPriority,
			enableDateSuggest:
				loaded && typeof loaded.enableDateSuggest === "boolean"
					? loaded.enableDateSuggest
					: DEFAULT_SETTINGS.enableDateSuggest,
			scanFolders:
				loaded && isValidScanFolders(loaded.scanFolders)
					? loaded.scanFolders
					: DEFAULT_SETTINGS.scanFolders,
			defaultDueWindow:
				loaded && isValidDueWindow(loaded.defaultDueWindow)
					? loaded.defaultDueWindow
					: DEFAULT_SETTINGS.defaultDueWindow,
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async activateTaskView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(TASK_VIEW_TYPE);
		if (existing.length > 0) {
			await this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: TASK_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}
}

class TodotxtMdSettingTab extends PluginSettingTab {
	plugin: TodotxtMdPlugin;

	constructor(app: App, plugin: TodotxtMdPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Default priority")
			.setDesc("Priority assigned when increasing priority from none (A-Z).")
			.addText((text) =>
				text.setValue(this.plugin.settings.defaultPriority).onChange(async (value) => {
					const upper = value.toUpperCase();
					if (isValidPriority(upper)) {
						this.plugin.settings.defaultPriority = upper;
						await this.plugin.saveSettings();
					}
				}),
			);

		new Setting(containerEl)
			.setName("Date shortcut suggestions")
			.setDesc('Show a live popup with date-shortcut suggestions after typing "due:" or "t:".')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enableDateSuggest).onChange(async (value) => {
					this.plugin.settings.enableDateSuggest = value;
					this.plugin.dateSuggest.setEnabled(value);
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Scan folders")
			.setDesc(
				"Folders to scan for the aggregated task view, one per line. Leave empty to scan the whole vault.",
			)
			.addTextArea((textArea) =>
				textArea.setValue(this.plugin.settings.scanFolders.join("\n")).onChange(async (value) => {
					const folders = value
						.split("\n")
						.map((line) => line.trim())
						.filter((line) => line.length > 0);
					this.plugin.settings.scanFolders = folders;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Default due window")
			.setDesc("Default due-date filter shown when the aggregated task view opens.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						all: "All",
						overdue: "Overdue",
						today: "Today",
						"this-week": "This week",
						none: "No due date",
					})
					.setValue(this.plugin.settings.defaultDueWindow)
					.onChange(async (value) => {
						this.plugin.settings.defaultDueWindow = value as TodotxtMdSettings["defaultDueWindow"];
						await this.plugin.saveSettings();
					}),
			);
	}
}
