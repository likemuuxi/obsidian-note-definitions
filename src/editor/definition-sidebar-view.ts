import { WorkspaceLeaf, TFile, setIcon, MarkdownView, Notice } from "obsidian";
import { DefinitionManagerView } from "src/editor/definition-manager-view";
import { ViewMode } from "src/settings";
import { getDefFileManager } from "src/core/def-file-manager";
import { AddDefinitionModal } from "src/editor/add-modal";
import { DefFileType } from "src/core/file-type";
import { DEFINITIONS_UPDATED_EVENT } from "src/core/def-file-updater";
import { Definition } from "src/core/model";

export const DEFINITION_SIDEBAR_VIEW_TYPE = "definition-sidebar-view";

export class DefinitionSidebarView extends DefinitionManagerView {
	protected managerOnly = true;
	private activeFile: TFile | null = null;
	private searchResults: { file: TFile; def: Definition; matches: Array<{ line: number; text: string }> } | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.allowRandomStyle = false;
	}

	async onOpen() {
		this.isViewActive = true;
		this.currentViewMode = ViewMode.Manager;
		this.browseMode = 'flashcard';

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', async () => {
				const nextFile = this.getActiveFile();
				if (nextFile?.path !== this.activeFile?.path) {
					this.activeFile = nextFile;
					await this.loadDefinitions();
					this.render();
				}
			})
		);
		this.registerEvent(
			this.app.workspace.on(DEFINITIONS_UPDATED_EVENT, async () => {
				this.activeFile = this.getActiveFile();
				await this.loadDefinitions();
				this.render();
			})
		);

		this.activeFile = this.getActiveFile();
		await this.loadDefinitions();
		this.render();
	}

	protected async loadDefinitions() {
		this.definitions = [];
		const defManager = getDefFileManager();
		const file = this.getActiveFile();

		if (file) {
			const content = (await this.app.vault.read(file)).toLowerCase();
			const matchedDefs = new Map<string, typeof this.definitions[number]>();
			const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

			defManager.globalDefs.getAllKeys().forEach(rawKey => {
				const key = rawKey?.toLowerCase();
				if (!key) return;

				// Match as a standalone word/phrase to avoid substring collisions
				const pattern = new RegExp(`(^|\\W)${escapeRegExp(key)}(\\W|$)`);
				if (!pattern.test(content)) return;

				const def = defManager.globalDefs.get(key);
				if (!def || !def.file) return;
				const uniqueKey = `${def.file.path}::${def.key}`;
				if (matchedDefs.has(uniqueKey)) return;

				const fileType = defManager.getFileType(def.file);
				matchedDefs.set(uniqueKey, {
					...def,
					sourceFile: def.file,
					fileType,
					filePath: def.file.path
				});
			});

			this.definitions = Array.from(matchedDefs.values());
		}

		this.applyFilters();
		this.searchResults = null;
	}

	private getActiveFile(): TFile | null {
		return this.app.workspace.getActiveFile();
	}

	// 全新侧边栏布局：显示当前文件的定义列表 + 搜索/排序/新增
	protected createDefinitionCard(container: Element, def: Definition & { sourceFile: TFile, filePath: string }): HTMLElement {
		const card = super.createDefinitionCard(container, def);

		// 文内搜索入口（仅侧边栏）
		const jumpContainer = card.createDiv({ cls: "def-card-jump def-card-search-btn" });
		const jumpBtn = jumpContainer.createEl("button", { cls: "def-card-action-btn" });
		this.setIconWithLabel(jumpBtn, "search");
		jumpBtn.setAttribute("aria-label", "Find in note");
		jumpBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.openSearchView(def);
		});

		return card;
	}

	private async openSearchView(def: Definition) {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice("No active file to search in.");
			return;
		}

		const content = await this.app.vault.read(activeFile);
		const lines = content.split(/\r?\n/);
		const needles = [def.word, ...(def.aliases || [])].filter(Boolean).map(s => s.toLowerCase());

		const matches: Array<{ line: number; text: string }> = [];
		lines.forEach((line, idx) => {
			const lower = line.toLowerCase();
			if (needles.some(n => n && lower.includes(n))) {
				matches.push({ line: idx, text: line.trim() || "(blank line)" });
			}
		});

		this.searchResults = { file: activeFile, def, matches };
		this.render();
	}

	private renderSearchResults(container: Element) {
		const header = container.createDiv({ cls: "def-search-header" });
		const backBtn = header.createEl("button", { cls: "def-toolbar-btn" });
		this.setIconWithLabel(backBtn, "arrow-left", "Back");
		backBtn.addEventListener("click", () => {
			this.searchResults = null;
			this.render();
		});

		const title = header.createEl("div", { cls: "def-search-title" });
		title.setText(`Matches for "${this.searchResults?.def.word}"`);

		const content = container.createDiv({ cls: "def-search-results" });
		content.style.padding = "0 8px 12px";
		content.style.display = "flex";
		content.style.flexDirection = "column";
		content.style.gap = "8px";

		if (!this.searchResults || this.searchResults.matches.length === 0) {
			const empty = content.createDiv({ cls: "def-manager-empty" });
			empty.createDiv({ text: "No matching lines found in this note.", cls: "def-empty-title" });
			return;
		}

		const list = content.createEl("ul", { cls: "def-usage-list" });
		list.style.listStyle = "none";
		list.style.padding = "0";
		list.style.margin = "0";
		list.style.display = "flex";
		list.style.flexDirection = "column";
		list.style.gap = "8px";
		list.style.width = "100%";

		const needles = [this.searchResults.def.word, ...(this.searchResults.def.aliases || [])]
			.filter(Boolean)
			.map(s => s.toLowerCase());

		this.searchResults.matches.forEach(match => {
			const item = list.createEl("li", { cls: "def-usage-item" });
			item.style.listStyle = "none";
			item.style.width = "100%";

			const card = item.createDiv({ cls: "def-usage-card" });
			card.style.display = "flex";
			card.style.flexDirection = "column";
			card.style.gap = "6px";
			card.style.padding = "10px 12px";
			card.style.borderRadius = "10px";
			card.style.border = "1px solid var(--background-modifier-border)";
			card.style.background = "var(--background-secondary)";
			card.style.boxShadow = "0 1px 2px var(--background-modifier-box-shadow)";
			card.style.cursor = "pointer";
			card.style.boxSizing = "border-box";

			const header = card.createDiv({ cls: "def-usage-header" });
			header.style.display = "flex";
			header.style.alignItems = "center";
			header.style.gap = "8px";

			const lineBadge = header.createDiv({ cls: "def-usage-line" });
			lineBadge.textContent = `Line ${match.line + 1}`;
			lineBadge.style.background = "var(--tag-background)";
			lineBadge.style.color = "var(--tag-color)";
			lineBadge.style.border = "1px solid var(--tag-border-color)";
			lineBadge.style.borderRadius = "6px";
			lineBadge.style.padding = "2px 8px";
			lineBadge.style.fontSize = "12px";

			const fileLabel = header.createDiv({ cls: "def-usage-file" });
			fileLabel.textContent = this.searchResults.file.name;
			fileLabel.style.fontSize = "12px";
			fileLabel.style.color = "var(--text-muted)";

			const body = card.createDiv({ cls: "def-usage-body" });
			body.style.whiteSpace = "normal";
			body.style.wordBreak = "break-word";
			body.style.textAlign = "left";
			body.style.lineHeight = "1.6";
			body.style.fontFamily = "var(--font-interface)";
			body.style.fontSize = "13px";

			body.innerHTML = `${this.highlightNeedles(match.text, needles)}`;

			card.addEventListener("click", async () => {
				if (!this.searchResults) return;
				const file = this.searchResults.file;
				const leaf = this.app.workspace.getLeaf(false);
				if (leaf) {
					// @ts-ignore openFile exists
					await (leaf as any).openFile(file);
				}
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				const editor = view?.editor;
				if (editor) {
					const len = this.safeLineLength(editor, match.line);
					editor.focus();
					editor.setSelection(
						{ line: match.line, ch: 0 },
						{ line: match.line, ch: len }
					);
					editor.scrollIntoView(
						{ from: { line: match.line, ch: 0 }, to: { line: match.line + 1, ch: 0 } },
						true
					);
				}
			});
		});
	}

	private safeLineLength(editor: any, line: number): number {
		try {
			const text = editor.getLine(line);
			return text?.length ?? 0;
		} catch {
			return 0;
		}
	}

	protected render() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("def-sidebar-view");
		container.toggleClass("def-search-mode", !!this.searchResults);

		if (this.searchResults) {
			this.renderSearchResults(container);
			return;
		}

		if (!this.activeFile) {
			const empty = container.createDiv({ cls: "def-manager-empty" });
			empty.createDiv({ text: "Open a definition file to view its content", cls: "def-empty-title" });
			return;
		}

		// 工具栏（单行图标）
		const toolbar = container.createDiv({ cls: "def-sidebar-toolbar" });
		const actions = toolbar.createDiv({ cls: "def-sidebar-actions" });

		const searchBtn = actions.createEl("button", { cls: "def-toolbar-btn icon-only" });
		this.setIconWithLabel(searchBtn, "search");

		const sortBtn = actions.createEl("button", { cls: "def-toolbar-btn icon-only" });
		this.setIconWithLabel(sortBtn, "sliders");

		let expandAll = false;
		const toggleAllBtn = actions.createEl("button", { cls: "def-toolbar-btn icon-only" });
		const updateToggleBtn = () => {
			const icon = expandAll ? "fold-vertical" : "unfold-vertical";
			const label = expandAll ? "Collapse all definitions" : "Expand all definitions";
			this.setIconWithLabel(toggleAllBtn, icon);
			toggleAllBtn.setAttr("aria-label", label);
			toggleAllBtn.setAttr("title", label);
		};
		updateToggleBtn();

		// const addBtn = actions.createEl("button", { cls: "def-toolbar-btn def-toolbar-btn-primary icon-only" });
		// this.setIconWithLabel(addBtn, "plus");
		// addBtn.addEventListener('click', () => {
		// 	const modal = new AddDefinitionModal(this.app);
		// 	modal.open();
		// });

		// 展开面板：搜索
		const searchPanel = container.createDiv({ cls: "sidebar-panel" });
		const searchInput = searchPanel.createEl("input", {
			cls: "def-manager-search",
			attr: { placeholder: "Search..." }
		});
		searchInput.value = this.searchTerm;
		searchInput.addEventListener('input', (e) => {
			this.searchTerm = (e.target as HTMLInputElement).value;
			this.applyFilters();
			this.updateDefinitionList();
		});

		// 展开面板：排序
		const sortPanel = container.createDiv({ cls: "sidebar-panel" });
		const sortSelect = sortPanel.createEl("select", { cls: "def-manager-select" });
		sortSelect.innerHTML = `
			<option value="name">Name</option>
			<option value="created">Created</option>
			<option value="modified">Modified</option>
		`;
		sortSelect.value = this.sortBy;
		sortSelect.addEventListener('change', (e) => {
			this.sortBy = (e.target as HTMLSelectElement).value;
			this.applyFilters();
			this.updateDefinitionList();
		});

		const orderBtn = sortPanel.createEl("button", { cls: "def-toolbar-btn" });
		const updateOrderBtn = () => {
			this.setIconWithLabel(orderBtn, this.sortOrder === 'asc' ? "arrow-up" : "arrow-down");
		};
		updateOrderBtn();
		orderBtn.addEventListener('click', () => {
			this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
			updateOrderBtn();
			this.applyFilters();
			this.updateDefinitionList();
		});

		let searchOpen = false;
		let sortOpen = false;

		const togglePanel = (panel: HTMLElement, open: boolean) => {
			panel.toggleClass("open", open);
		};

		// 类型切换标签
		const tabs = container.createDiv({ cls: "def-sidebar-tabs" });
		const tabItems: Array<{ key: string, label: string, icon: string }> = [
			{ key: 'all', label: 'All', icon: 'gallery-vertical-end' },
			{ key: DefFileType.Atomic, label: 'Atomic', icon: 'list' },
			{ key: DefFileType.Consolidated, label: 'Consolidated', icon: 'list-tree' },
		];
		tabItems.forEach(tab => {
			const tabEl = tabs.createEl("button", {
				cls: `def-sidebar-tab ${this.selectedFileType === tab.key ? 'active' : ''}`,
				attr: { 'aria-label': tab.label }
			});
			const iconSpan = tabEl.createSpan({ cls: "def-sidebar-tab-icon" });
			setIcon(iconSpan, tab.icon);
			tabEl.addEventListener('click', () => {
				this.selectedFileType = tab.key;
				this.selectedSourceFile = 'all';
				this.applyFilters();
				this.updateDefinitionList();
				tabs.querySelectorAll('.def-sidebar-tab').forEach(btn => btn.removeClass('active'));
				tabEl.addClass('active');
			});
		});

		searchBtn.addEventListener('click', () => {
			searchOpen = !searchOpen;
			if (searchOpen) sortOpen = false;
			togglePanel(searchPanel, searchOpen);
			togglePanel(sortPanel, sortOpen);
			if (searchOpen) searchInput.focus();
		});

		sortBtn.addEventListener('click', () => {
			sortOpen = !sortOpen;
			if (sortOpen) searchOpen = false;
			togglePanel(sortPanel, sortOpen);
			togglePanel(searchPanel, searchOpen);
		});

		const toggleDefinitions = (expand: boolean) => {
			const cards = container.querySelectorAll('.def-card-definition');
			cards.forEach(defEl => {
				const isExpanded = (defEl as HTMLElement).getAttribute("data-expanded") === "true";
				if (expand !== isExpanded) {
					defEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
				}
			});
		};

		toggleAllBtn.addEventListener('click', () => {
			expandAll = !expandAll;
			updateToggleBtn();
			toggleDefinitions(expandAll);
		});

		// 列表
		this.createDefinitionList(container);
	}

	// Sidebar 列表：直接纵向布局，不做瀑布流和随机样式
	protected updateDefinitionList(listContainer?: Element) {
		const list = listContainer || this.containerEl.querySelector('.def-manager-list');
		if (!list) return;

		list.empty();

		if (this.filteredDefinitions.length === 0) {
			const empty = list.createDiv({ cls: "def-manager-empty" });
			empty.createDiv({ text: "No matching definitions", cls: "def-empty-title" });
			return;
		}

		this.filteredDefinitions.forEach(def => {
			(this as any).createDefinitionCard(list, def);
		});
	}

	getViewType() {
		return DEFINITION_SIDEBAR_VIEW_TYPE;
	}

	getDisplayText() {
		return "Definition Sidebar";
	}

	getIcon() {
		return "star-list";
	}

	private highlightNeedles(text: string, needles: string[]): string {
		if (needles.length === 0) return text;
		const escaped = needles.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
		const regex = new RegExp(`(${escaped.join("|")})`, "gi");
		return text.replace(regex, '<mark>$1</mark>');
	}
}
