import { Plugin, PluginSettingTab, Setting, App, Menu, Editor } from "obsidian";
import {
	bumpPriorityAtCursor,
	expandDateTokenAtCursor,
	sortBlockAtCursor,
	toggleDoneAtCursor,
} from "./editor";
import { parseTaskLine } from "./parse";
import { TaskFieldSuggest } from "./taskSuggest";
import { VocabIndex } from "./vocabIndex";
import { AggregatedTaskView, TASK_VIEW_TYPE } from "./view";
import { buildHighlightExtension } from "./highlight";
import type { DueWindow } from "./aggregate";
import type { Clock } from "./dates";

interface TodotxtMdSettings {
	defaultPriority: string;
	enableDateSuggest: boolean;
	enableFieldMenu: boolean;
	suggestMaxItems: number;
	scanFolders: string[];
	defaultDueWindow: DueWindow;
	enableAggregatedViewPills: boolean;
	enableInEditorHighlight: boolean;
}

const DEFAULT_SETTINGS: TodotxtMdSettings = {
	defaultPriority: "A",
	enableDateSuggest: true,
	enableFieldMenu: true,
	suggestMaxItems: 10,
	scanFolders: [],
	defaultDueWindow: "all",
	enableAggregatedViewPills: true,
	enableInEditorHighlight: true,
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

function isValidMaxItems(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 50;
}

const systemClock: Clock = () => new Date();

export default class TodotxtMdPlugin extends Plugin {
	settings: TodotxtMdSettings = DEFAULT_SETTINGS;
	taskSuggest!: TaskFieldSuggest;
	vocabIndex!: VocabIndex;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.vocabIndex = new VocabIndex(this.app, () => this.settings.scanFolders);
		this.vocabIndex.register(this);
		this.taskSuggest = new TaskFieldSuggest(this.app, systemClock, this.vocabIndex);
		this.taskSuggest.configure({
			enabled: this.settings.enableDateSuggest,
			fieldMenu: this.settings.enableFieldMenu,
			maxItems: this.settings.suggestMaxItems,
		});
		this.registerEditorSuggest(this.taskSuggest);
		this.app.workspace.onLayoutReady(() => {
			void this.vocabIndex.get();
		});

		this.registerEditorExtension(
			buildHighlightExtension(() => this.settings.enableInEditorHighlight),
		);

		this.registerView(TASK_VIEW_TYPE, (leaf) => new AggregatedTaskView(leaf, this));

		this.addCommand({
			id: "open-aggregated-view",
			name: "Open aggregated task view",
			callback: () => this.activateTaskView(),
		});

		this.addCommand({
			id: "increase-priority",
			name: "Increase priority",
			editorCallback: (editor) => bumpPriorityAtCursor(editor, -1, this.settings.defaultPriority),
		});

		this.addCommand({
			id: "decrease-priority",
			name: "Decrease priority",
			editorCallback: (editor) => bumpPriorityAtCursor(editor, 1, this.settings.defaultPriority),
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

		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
				const lineText = editor.getLine(editor.getCursor().line);
				if (!parseTaskLine(lineText)) return;

				menu.addItem((item) =>
					item
						.setTitle("Sort checkbox block")
						.setIcon("arrow-down-up")
						.onClick(() => sortBlockAtCursor(editor)),
				);
				menu.addItem((item) =>
					item
						.setTitle("Toggle done")
						.setIcon("check-circle")
						.onClick(() => toggleDoneAtCursor(editor, systemClock)),
				);
			}),
		);

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
			enableFieldMenu:
				loaded && typeof loaded.enableFieldMenu === "boolean"
					? loaded.enableFieldMenu
					: DEFAULT_SETTINGS.enableFieldMenu,
			suggestMaxItems:
				loaded && isValidMaxItems(loaded.suggestMaxItems)
					? loaded.suggestMaxItems
					: DEFAULT_SETTINGS.suggestMaxItems,
			scanFolders:
				loaded && isValidScanFolders(loaded.scanFolders)
					? loaded.scanFolders
					: DEFAULT_SETTINGS.scanFolders,
			defaultDueWindow:
				loaded && isValidDueWindow(loaded.defaultDueWindow)
					? loaded.defaultDueWindow
					: DEFAULT_SETTINGS.defaultDueWindow,
			enableAggregatedViewPills:
				loaded && typeof loaded.enableAggregatedViewPills === "boolean"
					? loaded.enableAggregatedViewPills
					: DEFAULT_SETTINGS.enableAggregatedViewPills,
			enableInEditorHighlight:
				loaded && typeof loaded.enableInEditorHighlight === "boolean"
					? loaded.enableInEditorHighlight
					: DEFAULT_SETTINGS.enableInEditorHighlight,
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
			.setName("Inline suggestions")
			.setDesc(
				'Master switch for the live popups: date shortcuts after "due:"/"t:", the field menu, and +project/@place completion.',
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enableDateSuggest).onChange(async (value) => {
					this.plugin.settings.enableDateSuggest = value;
					this.plugin.taskSuggest.configure({ enabled: value });
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Field menu on space")
			.setDesc(
				"After typing a space on a task line, offer a menu of fields (priority, created date, due:, t:, +, @, #). Press Esc to dismiss it.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enableFieldMenu).onChange(async (value) => {
					this.plugin.settings.enableFieldMenu = value;
					this.plugin.taskSuggest.configure({ fieldMenu: value });
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Max suggestions")
			.setDesc("Most items shown in the field menu and the +project/@place lists (1-50).")
			.addText((text) =>
				text.setValue(String(this.plugin.settings.suggestMaxItems)).onChange(async (value) => {
					const parsed = Number(value);
					if (isValidMaxItems(parsed)) {
						this.plugin.settings.suggestMaxItems = parsed;
						this.plugin.taskSuggest.configure({ maxItems: parsed });
						await this.plugin.saveSettings();
					}
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
					// Rescan lazily on next use: eager rescans per keystroke would pile up.
					this.plugin.vocabIndex.invalidate();
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

		new Setting(containerEl)
			.setName("Aggregated view pills")
			.setDesc(
				"Show colored +project/@context/#context pills in the aggregated task view, with click-to-filter.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enableAggregatedViewPills).onChange(async (value) => {
					this.plugin.settings.enableAggregatedViewPills = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("In-editor highlighting")
			.setDesc(
				"Color +project, @context/#context, and date tokens inline while editing a task line.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enableInEditorHighlight).onChange(async (value) => {
					this.plugin.settings.enableInEditorHighlight = value;
					await this.plugin.saveSettings();
					this.app.workspace.updateOptions();
				}),
			);
	}
}
