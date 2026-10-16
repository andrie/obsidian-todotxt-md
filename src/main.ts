import { Plugin, PluginSettingTab, Setting, App, Menu, Editor } from "obsidian";
import {
	bumpPriorityAtCursor,
	expandDateTokenAtCursor,
	sortBlockAtCursor,
	cycleStatusAtCursor,
	createTaskAtCursor,
	cycleStatusAtLine,
	startIfEnteredProgress,
} from "./editor";
import type { EditorView } from "@codemirror/view";
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
			name: "Cycle status (open, in progress, done)",
			editorCallback: (editor) => cycleStatusAtCursor(editor, systemClock),
		});

		this.addCommand({
			id: "create-task",
			name: "Create task",
			editorCallback: (editor) => createTaskAtCursor(editor, systemClock),
		});

		// Stamp `start:` when a line becomes "- [/]" (typed, or via a checkbox click). Needs the
		// previous text of each line, which editor-change doesn't supply, so snapshot per editor.
		const snapshots = new WeakMap<Editor, string[]>();
		const snapshot = (editor: Editor | undefined) => {
			if (editor) snapshots.set(editor, editor.getValue().split("\n"));
		};
		this.registerEvent(
			this.app.workspace.on("file-open", () => snapshot(this.app.workspace.activeEditor?.editor)),
		);
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () =>
				snapshot(this.app.workspace.activeEditor?.editor),
			),
		);
		this.registerEvent(
			this.app.workspace.on("editor-change", (editor: Editor) => {
				const before = snapshots.get(editor);
				const after = editor.getValue().split("\n");
				snapshots.set(editor, after);
				if (!before || before.length !== after.length) return;
				for (let i = 0; i < after.length; i++) {
					if (before[i] === after[i]) continue;
					const stamped = startIfEnteredProgress(before[i], after[i], systemClock);
					if (stamped === null) continue;
					const cursor = editor.getCursor();
					editor.replaceRange(stamped, { line: i, ch: 0 }, { line: i, ch: after[i].length });
					editor.setCursor(cursor);
				}
			}),
		);

		// Obsidian's own checkbox click only flips "[ ]" and "[x]" and writes no dates. Intercept
		// it in the editor (capture phase, before Obsidian's handler) and cycle status instead.
		this.registerDomEvent(
			document,
			"click",
			(evt: MouseEvent) => {
				const target = evt.target;
				if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
				if (!target.classList.contains("task-list-item-checkbox")) return;
				const editor = this.app.workspace.activeEditor?.editor;
				const cm = (editor as unknown as { cm?: EditorView } | undefined)?.cm;
				if (!editor || !cm || !cm.dom.contains(target)) return;
				const lineNumber = editor.offsetToPos(cm.posAtDOM(target)).line;
				if (!cycleStatusAtLine(editor, lineNumber, systemClock)) return;
				evt.preventDefault();
				evt.stopPropagation();
			},
			true,
		);

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
						.setTitle("Cycle status")
						.setIcon("check-circle")
						.onClick(() => cycleStatusAtCursor(editor, systemClock)),
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

	/** Short user guide shown above the settings, so the plugin explains itself. */
	private renderHelp(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("How to use").setHeading();
		containerEl.createEl("p", {
			text:
				"Todo.txt MD adds todo.txt ergonomics to ordinary Markdown checkboxes. Your tasks " +
				"stay plain text, with no emojis and nothing that needs the plugin to be read.",
		});

		const sections: Array<[string, string[]]> = [
			[
				"Task syntax",
				[
					"- [ ] (A) 2026-09-19 Call the bank +Finance @phone #calls due:2026-09-25",
					"Priority (A)-(Z) comes first, then an optional created date. Add +projects, " +
						"@contexts or #tags anywhere, and due: or t: (start) dates as ISO YYYY-MM-DD.",
				],
			],
			[
				"Commands (bind your own hotkeys in Settings > Hotkeys)",
				[
					"Increase / Decrease priority, Cycle status (open, in progress, done; maintains dates), Create task, " +
						"Expand date token (tod, tom, mon, +3d become ISO dates), Sort current " +
						"checkbox block, and Open aggregated task view.",
				],
			],
			[
				"Typing help",
				[
					"After a space on a task line, a menu offers priority, dates, +project, " +
						"@place and #tag. Typing + or @ lists names already used in your tasks.",
				],
			],
			[
				"Aggregated task view",
				[
					"Lists every task in your vault (or the scan folders below). Filter by due " +
						"window, done state, or by clicking a +project / context pill. Tick a task " +
						"to complete it, or click it to jump to the line.",
				],
			],
			[
				"Note-level settings (Properties)",
				[
					"todotxt-ignore (checkbox): leave this note out of the aggregated view, for " +
						"example a shopping list.",
					"todotxt-projects and todotxt-contexts (lists): give every task in the note " +
						"these tags without typing them on each line. They show muted in the " +
						"aggregated view and are never written into your task lines.",
					"The nested form also works in source mode: todotxt: with ignore, projects " +
						"and contexts beneath it.",
				],
			],
		];

		for (const [title, lines] of sections) {
			containerEl.createEl("h4", { text: title });
			for (const line of lines) {
				if (line.startsWith("- [ ]")) {
					containerEl.createEl("code", { text: line });
				} else {
					containerEl.createEl("p", { text: line, cls: "setting-item-description" });
				}
			}
		}
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderHelp(containerEl);
		new Setting(containerEl).setName("Settings").setHeading();

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
