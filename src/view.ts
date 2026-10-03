import { ItemView, WorkspaceLeaf, TFile, debounce, type Editor } from "obsidian";
import type TodotxtMdPlugin from "./main";
import { parseTaskLine, serializeTask } from "./parse";
import { toggleDone } from "./editor";
import { aggregateTasks, DEFAULT_FILTER, type AggregateFilter, type TaskRecord } from "./aggregate";
import type { Clock } from "./dates";
import { nameToColor } from "./tokenColors";

export const TASK_VIEW_TYPE = "todotxt-md-aggregated-view";

const systemClock: Clock = () => new Date();

export class AggregatedTaskView extends ItemView {
	private plugin: TodotxtMdPlugin;
	private filter: AggregateFilter = { ...DEFAULT_FILTER };
	private records: TaskRecord[] = [];
	private clock: Clock;
	/**
	 * The record most recently toggled via the checkbox, kept visible through the very next
	 * render pass even if the current filter would otherwise exclude it (e.g. checking off a
	 * not-done task while "Include done" is off). Cleared after that render so a subsequent
	 * rescan or filter change applies the filter normally. See task-2 review fix.
	 */
	private justToggled: TaskRecord | null = null;

	private readonly handleVaultChange = debounce(
		() => {
			void this.rescan();
		},
		500,
		true,
	);

	constructor(leaf: WorkspaceLeaf, plugin: TodotxtMdPlugin, clock: Clock = systemClock) {
		super(leaf);
		this.plugin = plugin;
		this.clock = clock;
	}

	getViewType(): string {
		return TASK_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Tasks";
	}

	getIcon(): string {
		return "checkmark";
	}

	async onOpen(): Promise<void> {
		this.registerEvent(this.app.vault.on("modify", this.handleVaultChange));
		this.registerEvent(this.app.vault.on("create", this.handleVaultChange));
		this.registerEvent(this.app.vault.on("delete", this.handleVaultChange));
		this.registerEvent(this.app.vault.on("rename", this.handleVaultChange));

		this.filter = { ...DEFAULT_FILTER, dueWindow: this.plugin.settings.defaultDueWindow };
		await this.rescan();
	}

	private async rescan(): Promise<void> {
		this.records = await this.scanVault();
		this.render();
	}

	private async scanVault(): Promise<TaskRecord[]> {
		const files = this.app.vault.getMarkdownFiles();
		const scanFolders = this.plugin.settings.scanFolders;
		const scopedFiles = scanFolders.length
			? files.filter((f) =>
					scanFolders.some((folder) => f.path === folder || f.path.startsWith(folder + "/")),
				)
			: files;

		const records: TaskRecord[] = [];
		for (const file of scopedFiles) {
			const content = await this.app.vault.cachedRead(file);
			const lines = content.split("\n");
			lines.forEach((lineText, index) => {
				const task = parseTaskLine(lineText);
				if (task) records.push({ task, filePath: file.path, line: index });
			});
		}
		return records;
	}

	private render(): void {
		const container = this.contentEl;
		container.empty();

		this.renderFilterControls(container);

		const listEl = container.createDiv({ cls: "todotxt-md-task-list" });
		const visible = aggregateTasks(this.records, this.filter, this.clock);

		if (this.justToggled && !visible.includes(this.justToggled)) {
			visible.push(this.justToggled);
		}
		this.justToggled = null;

		if (visible.length === 0) {
			listEl.createDiv({ text: "No matching tasks.", cls: "todotxt-md-empty" });
			return;
		}

		for (const record of visible) {
			const item = listEl.createDiv({ cls: "todotxt-md-task-item" });
			if (record.task.done) item.addClass("is-done");

			const checkbox = item.createEl("input", { type: "checkbox" });
			checkbox.checked = record.task.done;
			checkbox.addEventListener("click", (evt) => {
				evt.stopPropagation();
				void this.toggleRecordDone(record);
			});

			item.addEventListener("click", () => {
				void this.jumpToTask(record);
			});
			this.renderTaskRow(item, record);
		}
	}

	private renderTaskRow(container: HTMLElement, record: TaskRecord): void {
		const { task } = record;

		if (task.priority) {
			container.createSpan({ text: `(${task.priority})`, cls: "todotxt-md-pill-priority" });
			container.appendText(" ");
		}
		if (task.creationDate) {
			container.createSpan({ text: task.creationDate, cls: "todotxt-md-date-segment" });
			container.appendText(" ");
		}
		container.createSpan({
			text: task.description || "(no description)",
			cls: "todotxt-md-description",
		});

		for (const project of task.projects) {
			container.appendText(" ");
			const pill = container.createSpan({
				text: `+${project}`,
				cls: "todotxt-md-pill todotxt-md-pill-project",
			});
			pill.style.color = nameToColor(project);
		}
		for (const context of task.contexts) {
			container.appendText(" ");
			const pill = container.createSpan({
				text: `#${context}`,
				cls: "todotxt-md-pill todotxt-md-pill-context",
			});
			pill.style.color = nameToColor(context);
		}

		if (task.due) {
			container.appendText(` due:${task.due}`);
		}
		container.appendText(` - ${record.filePath}`);
	}

	private renderFilterControls(container: HTMLElement): void {
		const controls = container.createDiv({ cls: "todotxt-md-filter-controls" });

		const dueWindowSelect = controls.createEl("select", { cls: "todotxt-md-due-filter" });
		const options: Array<[string, string]> = [
			["all", "All"],
			["overdue", "Overdue"],
			["today", "Today"],
			["this-week", "This week"],
			["none", "No due date"],
		];
		for (const [value, label] of options) {
			const opt = dueWindowSelect.createEl("option", { value, text: label });
			if (value === this.filter.dueWindow) opt.selected = true;
		}
		dueWindowSelect.addEventListener("change", () => {
			this.filter = {
				...this.filter,
				dueWindow: dueWindowSelect.value as AggregateFilter["dueWindow"],
			};
			this.render();
		});

		const includeDoneLabel = controls.createEl("label", { cls: "todotxt-md-include-done" });
		const includeDoneCheckbox = includeDoneLabel.createEl("input", { type: "checkbox" });
		includeDoneCheckbox.checked = this.filter.includeDone;
		includeDoneLabel.appendText(" Include done");
		includeDoneCheckbox.addEventListener("change", () => {
			this.filter = { ...this.filter, includeDone: includeDoneCheckbox.checked };
			this.render();
		});
	}

	private async jumpToTask(record: TaskRecord): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(record.filePath);
		if (!(file instanceof TFile)) return;

		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);

		const view = leaf.view as { editor?: Editor };
		if (view.editor) {
			view.editor.setCursor({ line: record.line, ch: 0 });
		}
	}

	private async toggleRecordDone(record: TaskRecord): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(record.filePath);
		if (!(file instanceof TFile)) return;

		const content = await this.app.vault.read(file);
		const lines = content.split("\n");
		const lineText = lines[record.line];
		const task = parseTaskLine(lineText);
		if (!task) return;

		const updated = toggleDone(task, this.clock);
		lines[record.line] = serializeTask(updated);
		await this.app.vault.modify(file, lines.join("\n"));

		record.task = updated;
		this.justToggled = record;
		this.render();
	}
}
