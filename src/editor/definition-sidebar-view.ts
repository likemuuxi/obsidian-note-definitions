import { WorkspaceLeaf, TFile } from "obsidian";
import { DefinitionManagerView } from "src/editor/definition-manager-view";
import { ViewMode } from "src/settings";
import { getDefFileManager } from "src/core/def-file-manager";
import { AddDefinitionModal } from "src/editor/add-modal";
import { FileParser } from "src/core/file-parser";
import { DefFileType } from "src/core/file-type";

export const DEFINITION_SIDEBAR_VIEW_TYPE = "definition-sidebar-view";

export class DefinitionSidebarView extends DefinitionManagerView {
	protected managerOnly = true;
	private activeFile: TFile | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
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
			const matchKeys = new Set<string>();

			defManager.globalDefs.getAllKeys().forEach(key => {
				if (!key) return;
				if (content.includes(key.toLowerCase())) {
					matchKeys.add(key.toLowerCase());
				}
			});

			matchKeys.forEach(key => {
				const def = defManager.globalDefs.get(key);
				if (!def || !def.file) return;
				const fileType = defManager.getFileType(def.file);
				this.definitions.push({
					...def,
					sourceFile: def.file,
					fileType,
					filePath: def.file.path
				});
			});
		}

		this.applyFilters();
	}

	private getActiveFile(): TFile | null {
		return this.app.workspace.getActiveFile();
	}

	// 全新侧边栏布局：显示当前文件的定义列表 + 搜索/排序/新增
	protected render() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("def-sidebar-view");

		if (!this.activeFile) {
			const empty = container.createDiv({ cls: "def-manager-empty" });
			const emptyIcon = empty.createDiv({ cls: "def-empty-icon" });
			emptyIcon.createSpan({ text: "!" });
			empty.createDiv({ text: "Open a definition file to view its content", cls: "def-empty-title" });
			return;
		}

		// 工具栏（单行图标）
		const toolbar = container.createDiv({ cls: "def-sidebar-toolbar" });
		const actions = toolbar.createDiv({ cls: "def-sidebar-actions" });

		// 类型切换标签
		const tabs = container.createDiv({ cls: "def-sidebar-tabs" });
		const tabItems: Array<{ key: string, label: string }> = [
			{ key: 'all', label: 'All' },
			{ key: DefFileType.Atomic, label: 'Atomic' },
			{ key: DefFileType.Consolidated, label: 'Consolidated' },
		];
		tabItems.forEach(tab => {
			const tabEl = tabs.createEl("button", {
				cls: `def-sidebar-tab ${this.selectedFileType === tab.key ? 'active' : ''}`,
				text: tab.label
			});
			tabEl.addEventListener('click', () => {
				this.selectedFileType = tab.key;
				this.selectedSourceFile = 'all';
				this.applyFilters();
				this.updateDefinitionList();
				tabs.querySelectorAll('.def-sidebar-tab').forEach(btn => btn.removeClass('active'));
				tabEl.addClass('active');
			});
		});

		const searchBtn = actions.createEl("button", { cls: "def-toolbar-btn" });
		this.setIconWithLabel(searchBtn, "search");

		const sortBtn = actions.createEl("button", { cls: "def-toolbar-btn" });
		this.setIconWithLabel(sortBtn, "sliders");

		const addBtn = actions.createEl("button", { cls: "def-toolbar-btn def-toolbar-btn-primary" });
		this.setIconWithLabel(addBtn, "plus");
		addBtn.addEventListener('click', () => {
			const modal = new AddDefinitionModal(this.app);
			modal.open();
		});

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

		// 列表
		this.createDefinitionList(container);
	}

	getViewType() {
		return DEFINITION_SIDEBAR_VIEW_TYPE;
	}

	getDisplayText() {
		return "Definition Manager";
	}

	getIcon() {
		return "star-list";
	}
}
