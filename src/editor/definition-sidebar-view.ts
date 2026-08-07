import { WorkspaceLeaf, TFile, setIcon, MarkdownView, Notice, MarkdownRenderer, DropdownComponent } from "obsidian";
import { DefinitionManagerView } from "src/editor/definition-manager-view";
import { getDefFileManager } from "src/core/def-file-manager";
import { AddDefinitionModal } from "src/editor/add-modal";
import { DefFileType } from "src/core/file-type";
import { DEFINITIONS_UPDATED_EVENT } from "src/core/def-file-updater";
import { Definition } from "src/core/model";
import { t } from "src/i18n";
import { debounce } from "src/util/debounce";

export const DEFINITION_SIDEBAR_VIEW_TYPE = "definition-sidebar-view";

export class DefinitionSidebarView extends DefinitionManagerView {
	protected managerOnly = true;
	private activeFile: TFile | null = null;
	private searchResults: {
		file: TFile;
		def: Definition;
		matches: Array<{ line: number; text: string }>;
		needles: string[];
		matchRegex: RegExp | null;
		highlightRegex: RegExp | null;
	} | null = null;
	private sidebarScrollTop: number | null = null;
	private selectedSearchMatchIndex: number | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.allowRandomStyle = false;
	}

	async onOpen() {
		this.isViewActive = true;

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
			this.app.workspace.on(DEFINITIONS_UPDATED_EVENT as any, async () => {
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
			const matchedDefs = new Map<string, Definition & { sourceFile: TFile; fileType: DefFileType; filePath: string; occurrenceCount: number }>();
			const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

			// Build a combined regex to scan content in a single pass
			const allKeys = defManager.globalDefs.getAllKeys()
				.map(k => k?.toLowerCase())
				.filter((k): k is string => !!k);

			if (allKeys.length > 0) {
				// Build key → original definition mapping for deduplication
				const keyToDefKey = new Map<string, string>();
				for (const rawKey of allKeys) {
					const def = defManager.globalDefs.get(rawKey);
					if (def && def.file) {
						keyToDefKey.set(rawKey, `${def.file.path}::${def.key}`);
					}
				}

				// Single combined pattern: (^|\W)(key1|key2|...)(\W|$)
				const combinedPattern = new RegExp(
					`(^|\\W)(${allKeys.map(k => escapeRegExp(k)).join("|")})(\\W|$)`,
					"g"
				);

				// Count matches per key in a single pass
				const matchCounts = new Map<string, number>();
				let m: RegExpExecArray | null;
				while ((m = combinedPattern.exec(content)) !== null) {
					const matchedKey = m[2];
					matchCounts.set(matchedKey, (matchCounts.get(matchedKey) ?? 0) + 1);
					// Avoid zero-length match infinite loop
					if (m.index === combinedPattern.lastIndex) {
						combinedPattern.lastIndex++;
					}
				}

				for (const [key, count] of matchCounts) {
					if (count === 0) continue;
					const uniqueKey = keyToDefKey.get(key);
					if (!uniqueKey || matchedDefs.has(uniqueKey)) continue;

					const def = defManager.globalDefs.get(key);
					if (!def || !def.file) continue;

					const fileType = defManager.getFileType(def.file);
					matchedDefs.set(uniqueKey, {
						...def,
						sourceFile: def.file,
						fileType,
						filePath: def.file.path,
						occurrenceCount: count
					});
				}
			}

			this.definitions = Array.from(matchedDefs.values());
		}

		this.applyFilters();
		this.searchResults = null;
	}

	private getActiveFile(): TFile | null {
		return this.app.workspace.getActiveFile();
	}

	// 全新侧边栏布局：显示当前文件的定义列表 + 搜索/排序/新增
	protected createDefinitionCard(container: Element, def: Definition & { sourceFile: TFile, filePath: string, occurrenceCount: number }): HTMLElement {
		const card = super.createDefinitionCard(container, def);

		// 文内搜索入口（仅侧边栏）
		const jumpContainer = card.createDiv({ cls: "def-card-jump def-card-search-btn" });
		const jumpBtn = jumpContainer.createEl("button", { cls: "def-card-action-btn" });
		this.setIconWithLabel(jumpBtn, "search");
		jumpBtn.setAttribute("aria-label", t("Find in note"));
		jumpBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.openSearchView(def);
		});

		return card;
	}

	private async openSearchView(def: Definition) {
		const scroller = this.getSidebarScrollElement();
		if (scroller) {
			this.sidebarScrollTop = scroller.scrollTop;
		}

		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice(t("No active file to search in."));
			return;
		}

		const content = await this.app.vault.read(activeFile);
		const lines = content.split(/\r?\n/);
		const needles = Array.from(
			new Set([def.word, ...(def.aliases || [])].map(s => s?.trim()).filter(Boolean) as string[])
		);
		const patterns = needles
			.slice()
			.sort((a, b) => b.length - a.length)
			.map(n => this.buildNeedlePattern(n));
		const combinedPattern = patterns.length > 0 ? `(?:${patterns.join("|")})` : "";
		const matchRegex = combinedPattern ? new RegExp(combinedPattern, "i") : null;
		const highlightRegex = combinedPattern ? new RegExp(combinedPattern, "gi") : null;

		const matches: Array<{ line: number; text: string }> = [];
		lines.forEach((line, idx) => {
			if (!matchRegex) return;
			if (matchRegex.test(line)) {
				matches.push({ line: idx, text: line.trim() || `(${t("Blank line")})` });
			}
		});

		this.searchResults = { file: activeFile, def, matches, needles, matchRegex, highlightRegex };
		this.selectedSearchMatchIndex = null;
		this.render();
	}

	private getSidebarScrollElement(): HTMLElement | null {
		const listSection = this.containerEl.querySelector('.def-sidebar-list-section') as HTMLElement | null;
		if (listSection) return listSection;
		return this.containerEl.querySelector('.def-sidebar-list') as HTMLElement | null;
	}

	private renderSearchResults(container: Element) {
		const header = container.createDiv({ cls: "def-search-header" });
		const backBtn = header.createEl("button", { cls: "def-toolbar-btn" });
		this.setIconWithLabel(backBtn, "arrow-left", t("Back"));
		backBtn.addEventListener("click", () => {
			this.searchResults = null;
			this.selectedSearchMatchIndex = null;
			this.render();
		});

		const title = header.createEl("div", { cls: "def-search-title" });
		title.setText(t("Matches for \"{{word}}\"", { word: this.searchResults?.def.word ?? "" }));

		const content = container.createDiv({ cls: "def-search-results" });

		if (!this.searchResults || this.searchResults.matches.length === 0) {
			const empty = content.createDiv({ cls: "def-manager-empty" });
			empty.createDiv({ text: t("No matching lines found in this note."), cls: "def-empty-title" });
			return;
		}

		const list = content.createEl("ul", { cls: "def-usage-list" });
		const highlightRegex = this.searchResults.highlightRegex;

		this.searchResults.matches.forEach((match, index) => {
			const item = list.createEl("li", { cls: "def-usage-item" });
			const card = item.createDiv({ cls: "def-usage-card" });
			if (index === this.selectedSearchMatchIndex) {
				card.addClass("active");
			}

			const header = card.createDiv({ cls: "def-usage-header" });

			const lineBadge = header.createDiv({ cls: "def-usage-line" });
			lineBadge.textContent = t("Line {{line}}", { line: match.line + 1 });

			const fileLabel = header.createDiv({ cls: "def-usage-file" });
			fileLabel.textContent = this.searchResults?.file.name ?? "";

			const body = card.createDiv({ cls: "def-usage-body" });
			const renderedBody = body.createDiv({ cls: "def-usage-body-md" });
			MarkdownRenderer.render(
				this.app,
				this.highlightNeedles(match.text, highlightRegex),
				renderedBody,
				this.searchResults?.file.path ?? "",
				this
			);

			card.addEventListener("click", async () => {
				list.querySelectorAll(".def-usage-card.active").forEach(el => el.removeClass("active"));
				card.addClass("active");
				this.selectedSearchMatchIndex = index;

				if (!this.searchResults) return;
				const file = this.searchResults.file;
				const leaf = this.app.workspace.getLeaf(false);
				if (leaf) {
					// @ts-ignore openFile exists
					await (leaf as any).openFile(file, {
						eState: {
							line: match.line,
							mode: "source"
						}
					});
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

	protected applyFilters() {
		super.applyFilters();

		if (this.sortBy === 'occurrences') {
			this.filteredDefinitions.sort((a: any, b: any) => {
				const comparison = (a.occurrenceCount ?? 0) - (b.occurrenceCount ?? 0);
				return this.sortOrder === 'desc' ? -comparison : comparison;
			});
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
			empty.createDiv({ text: t("Open a definition file to view its content"), cls: "def-empty-title" });
			return;
		}

		// 工具栏（单行图标）
		const topControls = container.createDiv({ cls: "def-sidebar-top" });

		const toolbar = topControls.createDiv({ cls: "def-sidebar-toolbar" });

		// 直接展示搜索框（使用 Obsidian 原生样式）
		const searchContainer = toolbar.createDiv({ cls: "search-input-container def-sidebar-search" });
		const searchInput = searchContainer.createEl("input", {
			cls: "search-input",
			type: "search",
			attr: { placeholder: t("Search definitions...") }
		});
		searchInput.value = this.searchTerm;
		const debouncedSearch = debounce((value: string) => {
			this.searchTerm = value;
			this.applyFilters();
			this.updateDefinitionList();
		}, 250);
		searchInput.addEventListener('input', (e) => {
			debouncedSearch((e.target as HTMLInputElement).value);
		});

		const actions = toolbar.createDiv({ cls: "def-sidebar-actions" });

		let expandAll = false;
		const toggleAllBtn = actions.createEl("button", { cls: "def-toolbar-btn icon-only" });
		const updateToggleBtn = () => {
			const icon = expandAll ? "fold-vertical" : "unfold-vertical";
			const label = expandAll ? t("Collapse all definitions") : t("Expand all definitions");
			this.setIconWithLabel(toggleAllBtn, icon);
			toggleAllBtn.setAttr("aria-label", label);
			toggleAllBtn.setAttr("title", label);
		};
		updateToggleBtn();

		const sortOptions = [
			{ key: 'name', order: 'asc', label: t("File name (A–Z)") },
			{ key: 'name', order: 'desc', label: t("File name (Z–A)") },
			{ key: 'occurrences', order: 'desc', label: t("Occurrences (high to low)") },
			{ key: 'occurrences', order: 'asc', label: t("Occurrences (low to high)") },
			{ key: 'modified', order: 'desc', label: t("Modified (newest first)") },
			{ key: 'modified', order: 'asc', label: t("Modified (oldest first)") },
			{ key: 'created', order: 'desc', label: t("Created (newest first)") },
			{ key: 'created', order: 'asc', label: t("Created (oldest first)") },
		];

		const sortRow = topControls.createDiv({ cls: "def-sort-row" });
		const sortControls = sortRow.createDiv({ cls: "def-sort-controls" });

		const typeLabels: Record<string, string> = {
			all: t("All"),
			[DefFileType.Atomic]: t("Atomic"),
			[DefFileType.Consolidated]: t("Consolidated"),
		};
		const typeDropdown = new DropdownComponent(sortControls);
		typeDropdown.selectEl.addClass("def-type-dropdown");
		Object.entries(typeLabels).forEach(([key, label]) => {
			typeDropdown.addOption(key, label);
		});
		typeDropdown.setValue(this.selectedFileType ?? 'all');
		typeDropdown.onChange(async (value) => {
			if (this.selectedFileType === value) return;
			this.selectedFileType = value;
			this.selectedSourceFile = 'all';
			await this.loadDefinitions();
			this.updateDefinitionList();
		});

		const sortDropdown = new DropdownComponent(sortControls);
		sortDropdown.selectEl.addClass("def-sort-dropdown");
		sortOptions.forEach(item => {
			sortDropdown.addOption(`${item.key}:${item.order}`, item.label);
		});
		const setSortDropdown = () => {
			const current = `${this.sortBy}:${this.sortOrder}`;
			const fallback = 'name:asc';
			sortDropdown.setValue(sortOptions.some(o => `${o.key}:${o.order}` === current) ? current : fallback);
		};
		setSortDropdown();
		sortDropdown.onChange((value) => {
			const [key, order] = value.split(':');
			this.sortBy = key;
			this.sortOrder = order;
			this.applyFilters();
			this.updateDefinitionList();
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
		const listSection = container.createDiv({ cls: "def-sidebar-list-section" });
		this.createSidebarDefinitionList(listSection);

		// 恢复退出搜索时的滚动位置
		if (this.sidebarScrollTop !== null) {
			const scroller = this.getSidebarScrollElement();
			if (scroller) {
				scroller.scrollTo({ top: this.sidebarScrollTop });
			}
			this.sidebarScrollTop = null;
		}
	}

	// Sidebar 列表：纵向布局，分批渲染 + IntersectionObserver 懒加载
	protected updateDefinitionList(listContainer?: Element) {
		const list = listContainer || this.containerEl.querySelector('.def-sidebar-list');
		if (!list) return;

		list.empty();

		// Clean up previous observer
		if (this.observer) {
			this.observer.disconnect();
			this.observer = null;
		}
		this.loadingSentinel = null;

		if (this.filteredDefinitions.length === 0) {
			const empty = list.createDiv({ cls: "def-manager-empty" });
			empty.createDiv({ text: t("No matching definitions"), cls: "def-empty-title" });
			return;
		}

		this.page = 1;
		this.renderSidebarBatch(list as HTMLElement, 0);
	}

	private renderSidebarBatch(list: HTMLElement, startIndex: number) {
		const batch = this.filteredDefinitions.slice(startIndex, startIndex + this.pageSize);
		const cards: HTMLElement[] = [];

		batch.forEach(def => {
			const card = (this as any).createDefinitionCard(list, def);
			cards.push(card);
		});

		this.waitForCardsToRender(cards).then(() => {
			// Setup lazy loading if more items exist
			if (startIndex + this.pageSize < this.filteredDefinitions.length) {
				this.setupSidebarLazyLoading(list);
			}
		});
	}

	private setupSidebarLazyLoading(list: HTMLElement) {
		if (this.loadingSentinel) {
			this.loadingSentinel.remove();
		}

		this.loadingSentinel = list.createDiv({ cls: "def-loading-sentinel" });
		this.loadingSentinel.style.height = "20px";
		this.loadingSentinel.style.width = "100%";

		if (!this.observer) {
			this.observer = new IntersectionObserver((entries) => {
				if (entries[0].isIntersecting) {
					// Disconnect and load next batch
					if (this.observer) {
						this.observer.disconnect();
						this.observer = null;
					}
					if (this.loadingSentinel) {
						this.loadingSentinel.remove();
						this.loadingSentinel = null;
					}
					this.page++;
					const startIndex = (this.page - 1) * this.pageSize;
					this.renderSidebarBatch(list, startIndex);
				}
			}, { rootMargin: '200px' });
		}

		this.observer.observe(this.loadingSentinel);
	}

	getViewType() {
		return DEFINITION_SIDEBAR_VIEW_TYPE;
	}

	getDisplayText() {
		return t("Definition Sidebar");
	}

	getIcon() {
		return "star-list";
	}

	private highlightNeedles(text: string, highlightRegex: RegExp | null): string {
		if (!highlightRegex) return text;
		return text.replace(highlightRegex, "<mark>$&</mark>");
	}

	private buildNeedlePattern(needle: string): string {
		const escaped = this.escapeRegExp(needle);
		if (/^[A-Za-z](?:[A-Za-z\s'-]*[A-Za-z])?$/.test(needle)) {
			return `\\b${escaped}\\b`;
		}
		return escaped;
	}

	private escapeRegExp(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}
}
