import { Plugin, PluginSettingTab, Setting, App } from "obsidian";
import {
	bumpPriorityAtCursor,
	expandDateTokenAtCursor,
	sortBlockAtCursor,
	toggleDoneAtCursor,
} from "./editor";
import { DateShortcutSuggest } from "./dateSuggest";
import type { Clock } from "./dates";

interface TodotxtMdSettings {
	defaultPriority: string;
	enableDateSuggest: boolean;
}

const DEFAULT_SETTINGS: TodotxtMdSettings = {
	defaultPriority: "A",
	enableDateSuggest: true,
};

function isValidPriority(value: unknown): value is string {
	return typeof value === "string" && /^[A-Z]$/.test(value);
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

		this.addCommand({
			id: "increase-priority",
			name: "Increase priority",
			editorCallback: (editor) => bumpPriorityAtCursor(editor, -1),
		});

		this.addCommand({
			id: "decrease-priority",
			name: "Decrease priority",
			editorCallback: (editor) => bumpPriorityAtCursor(editor, 1),
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
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
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
	}
}
