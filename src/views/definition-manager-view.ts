import { ItemView, WorkspaceLeaf, Notice, Setting, TFile, MarkdownRenderer, Component, Modal, setIcon, DropdownComponent } from "obsidian";
import { getDefFileManager } from "src/core/def-file-manager";
import { DefFileUpdater } from "src/core/def-file-updater";
import { DefFileType } from "src/core/file-type";
import { Definition } from "src/core/model";
import { EditDefinitionModal } from "src/editor/edit-modal";
import { getLocale, t } from "src/i18n";
import { debounce } from "src/util/debounce";
export const DEFINITION_MANAGER_VIEW_TYPE = "definition-manager-view";

interface DefinitionWithSource extends Definition {
    sourceFile: TFile;
    filePath: string;
}

export class DefinitionManagerView extends ItemView {
    definitions: DefinitionWithSource[] = [];
    filteredDefinitions: DefinitionWithSource[] = [];

    // 筛选和搜索状态
    protected searchTerm: string = '';
    protected selectedFileType: string = 'all';
    protected sortBy: string = 'name'; // name, created, modified
    protected sortOrder: string = 'asc'; // asc, desc

    // 瀑布流布局相关
    protected columnCount: number = 0;
    protected columnHeights: number[] = [];
    protected cardWidth: number = 280;
    protected gap: number = 16;
    protected resizeObserver?: ResizeObserver;

    // 设置相关
	protected enableTruncation: boolean = true;
	protected isViewActive: boolean = false;
	protected managerOnly: boolean = false;
	protected allowRandomStyle: boolean = true;
	private relayoutTimeout?: number;

    // 布局模式
    protected viewLayout: 'masonry' | 'gallery' = 'masonry';
    protected galleryIndex: number = 0;

    // 文件夹侧边栏
    protected selectedFolder: string | null = null;
    protected collapsedFolders: Set<string> = new Set();

    // Lazy loading
    protected page: number = 1;
    protected pageSize: number = 20;
    protected observer: IntersectionObserver | null = null;
    protected loadingSentinel: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType() {
        return DEFINITION_MANAGER_VIEW_TYPE;
    }

    getDisplayText() {
        return t("Definition Manager");
    }

    getIcon() {
        return "swatch-book";
    }

	protected setIconWithLabel(target: HTMLElement, icon: string, label?: string) {
		target.empty();
		if(label === undefined || label === "") {
			target.addClass("icon-only");
		} else {
			target.addClass("with-icon");
		}
		
		const iconSpan = target.createSpan({ cls: "with-icon-icon" });
		setIcon(iconSpan, icon);

		if (label) {
			target.createSpan({ text: label, cls: "with-icon-label" });
			if (!target.getAttribute("aria-label")) {
				target.setAttribute("aria-label", label);
			}
		}

		return target;
	}

	private createIconHeading(parent: Element, tag: keyof HTMLElementTagNameMap, icon: string, text: string) {
		const heading = parent.createEl(tag, { cls: "with-icon" });
		this.setIconWithLabel(heading as HTMLElement, icon, text);
		return heading;
	}

    async onOpen() {
        this.isViewActive = true;

        await this.loadDefinitions();
        this.render();
    }

    async onClose() {
        // 清理ResizeObserver
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = undefined;
        }

        // 清理窗口大小变化监听器
        if (this.cleanupResizeListener) {
            this.cleanupResizeListener();
            this.cleanupResizeListener = undefined;
        }

        // 清理定时器
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = undefined;
        }
		if (this.relayoutTimeout) {
			window.clearTimeout(this.relayoutTimeout);
			this.relayoutTimeout = undefined;
		}

        // 重置状态
        this.isViewActive = false;
    }

    protected async loadDefinitions() {
        this.definitions = [];
        const defManager = getDefFileManager();

        // 加载所有定义文件中的定义
        for (const [filePath, file] of defManager.globalDefFiles) {
            const definitions = defManager.getDefinitionsFromFile(file);
            const fileType = defManager.getFileType(file);

            definitions.forEach(def => {
                this.definitions.push({
                    ...def,
                    sourceFile: file,
                    fileType: fileType,
                    filePath: filePath
                });
            });
        }

        this.applyFilters();
    }

	private getSearchTokens(term: string): string[] {
		return term
			.toLowerCase()
			.split(/\s+/)
			.map(t => t.trim())
			.filter(Boolean);
	}

	private matchesSearch(def: DefinitionWithSource, term: string): boolean {
		const tokens = this.getSearchTokens(term);
		if (tokens.length === 0) return true;

		const word = def.word.toLowerCase();
		const definition = def.definition.toLowerCase();
		const aliases = (def.aliases || []).map(a => String(a).toLowerCase());

		return tokens.every(token =>
			word.includes(token) ||
			definition.includes(token) ||
			aliases.some(a => a.includes(token))
		);
	}

    protected applyFilters() {
        this.filteredDefinitions = this.definitions.filter(def => {
            // 搜索过滤
            if (this.searchTerm && !this.matchesSearch(def, this.searchTerm)) return false;

            // 文件类型过滤
            if (this.selectedFileType !== 'all' && def.fileType !== this.selectedFileType) {
                return false;
            }

            // 文件夹侧边栏过滤（包含子文件夹）
            if (this.selectedFolder !== null) {
                const defFolderPath = def.filePath.split('/').slice(0, -1).join('/');
                if (defFolderPath !== this.selectedFolder && !defFolderPath.startsWith(this.selectedFolder + '/')) {
                    return false;
                }
            }

            return true;
        });

        // 排序
        this.filteredDefinitions.sort((a, b) => {
            let comparison = 0;

            switch (this.sortBy) {
                case 'name':
                    comparison = a.sourceFile.name.localeCompare(b.sourceFile.name) || a.word.localeCompare(b.word);
                    break;
				case 'occurrences':
					comparison = ((a as any).occurrenceCount ?? 0) - ((b as any).occurrenceCount ?? 0);
					break;
                case 'created':
                    // 按文件创建时间排序
                    comparison = a.sourceFile.stat.ctime - b.sourceFile.stat.ctime;
                    break;
                case 'modified':
                    // 按文件修改时间排序
                    comparison = a.sourceFile.stat.mtime - b.sourceFile.stat.mtime;
                    break;
            }

            return this.sortOrder === 'desc' ? -comparison : comparison;
        });
    }

	private escapeHtml(text: string): string {
		return text
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	private highlightText(text: string, term: string): string {
		const tokens = this.getSearchTokens(term);
		if (tokens.length === 0) return this.escapeHtml(text);

		const escapedTokens = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
		const regex = new RegExp(`(${escapedTokens.join("|")})`, "gi");

		let result = "";
		let lastIndex = 0;
		for (const match of text.matchAll(regex)) {
			const index = match.index ?? 0;
			const matched = match[0] ?? "";
			result += this.escapeHtml(text.slice(lastIndex, index));
			result += `<mark>${this.escapeHtml(matched)}</mark>`;
			lastIndex = index + matched.length;
		}
		result += this.escapeHtml(text.slice(lastIndex));
		return result;
	}

	private scheduleRelayout() {
		if (this.managerOnly) return;
		if (this.viewLayout !== 'masonry') return;

		if (this.relayoutTimeout) window.clearTimeout(this.relayoutTimeout);
		this.relayoutTimeout = window.setTimeout(() => {
			const list = this.containerEl.querySelector(".def-manager-list") as HTMLElement | null;
			if (!list) return;
			const cards = Array.from(list.querySelectorAll<HTMLElement>(".def-card"));
			if (cards.length === 0) return;

			this.waitForCardsToRender(cards).then(() => {
				this.layoutMasonry(list, cards);
			});
		}, 0);
	}

    	protected render() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("def-manager-view-container");

		// 创建主布局：左侧文件夹面板 + 右侧内容
		const mainLayout = container.createDiv({ cls: "def-manager-layout" });
		if (!this.managerOnly) {
			mainLayout.addClass("with-sidebar");
			const sidebar = mainLayout.createDiv({ cls: "def-folder-sidebar" });
			this.renderFolderSidebar(sidebar);
		}

		const contentArea = mainLayout.createDiv({ cls: "def-manager-content" });
		this.createManagerToolbar(contentArea);
		this.createDefinitionList(contentArea);
	}

    protected renderFolderSidebar(sidebar: HTMLElement) {
        sidebar.empty();

        const header = sidebar.createDiv({ cls: "def-folder-sidebar-header" });
        header.createEl("h3", { text: t("Folders") });

        const list = sidebar.createDiv({ cls: "def-folder-sidebar-list" });

        // 构建文件夹树
        const tree = this.buildFolderTree();

        // "All" 选项
        const allItem = list.createDiv({
            cls: `def-folder-item ${this.selectedFolder === null ? 'active' : ''}`
        });
        allItem.createSpan({ cls: "def-folder-item-name", text: t("All") });
        allItem.createSpan({ cls: "def-folder-count", text: `${this.definitions.length}` });
        allItem.addEventListener("click", () => {
            this.selectedFolder = null;
            this.applyFolderFilter();
            this.updateDefinitionList();
            this.renderFolderSidebar(sidebar);
        });

        // 递归渲染树
        this.renderFolderTreeNodes(list, tree, 0, sidebar);
    }

    private buildFolderTree(): Map<string, { name: string; path: string; count: number; children: Map<string, any> }> {
        type TreeNode = { name: string; path: string; count: number; children: Map<string, TreeNode> };
        const root = new Map<string, TreeNode>();

        // 以定义文件夹本身作为根节点，避免显示其父级/祖先文件夹
        const defFolder = (getDefFileManager()?.getGlobalDefFolder() || "").replace(/\/+$/, "");
        const defPrefixParts = defFolder ? defFolder.split('/') : [];
        const defFolderName = defPrefixParts.length > 0 ? defPrefixParts[defPrefixParts.length - 1] : '';
        const defRootNode: TreeNode | null = defPrefixParts.length > 0
            ? { name: defFolderName, path: defFolder, count: 0, children: new Map() }
            : null;
        if (defRootNode) {
            root.set(defFolderName, defRootNode);
        }

        this.definitions.forEach(def => {
            const parts = def.filePath.split('/');
            const folderParts = parts.slice(0, -1); // 去掉文件名

            // 位于定义文件夹内：以定义文件夹为根，仅展开其子文件夹
            const underDefFolder = defRootNode !== null
                && folderParts.length >= defPrefixParts.length
                && folderParts.slice(0, defPrefixParts.length).join('/') === defFolder;

            if (underDefFolder && defRootNode) {
                const relParts = folderParts.slice(defPrefixParts.length);
                if (relParts.length === 0) {
                    // 文件直接位于定义文件夹内
                    defRootNode.count++;
                    return;
                }
                let currentPath = defFolder;
                let currentLevel = defRootNode.children;
                relParts.forEach((part, idx) => {
                    currentPath = `${currentPath}/${part}`;
                    if (!currentLevel.has(part)) {
                        currentLevel.set(part, { name: part, path: currentPath, count: 0, children: new Map() });
                    }
                    const node = currentLevel.get(part)!;
                    // 叶子文件夹累加计数
                    if (idx === relParts.length - 1) {
                        node.count++;
                    }
                    currentLevel = node.children;
                });
                return;
            }

            // 回退：未配置定义文件夹或文件不在定义文件夹内时，使用完整路径
            if (folderParts.length === 0) {
                const rootName = '/';
                if (!root.has(rootName)) {
                    root.set(rootName, { name: '/', path: '', count: 0, children: new Map() });
                }
                root.get(rootName)!.count++;
                return;
            }
            let currentPath = '';
            let currentLevel = root;
            folderParts.forEach((part, idx) => {
                currentPath = currentPath ? `${currentPath}/${part}` : part;
                if (!currentLevel.has(part)) {
                    currentLevel.set(part, { name: part, path: currentPath, count: 0, children: new Map() });
                }
                const node = currentLevel.get(part)!;
                if (idx === folderParts.length - 1) {
                    node.count++;
                }
                currentLevel = node.children;
            });
        });

        return root;
    }

    private renderFolderTreeNodes(
        container: HTMLElement,
        nodes: Map<string, { name: string; path: string; count: number; children: Map<string, any> }>,
        depth: number,
        sidebar: HTMLElement
    ) {
        const sortedKeys = Array.from(nodes.keys()).sort();
        for (const key of sortedKeys) {
            const node = nodes.get(key)!;
            const hasChildren = node.children.size > 0;
            const isCollapsed = this.collapsedFolders.has(node.path);

            const item = container.createDiv({
                cls: `def-folder-item def-folder-tree-item ${this.selectedFolder === node.path ? 'active' : ''}`
            });
            item.style.paddingLeft = `${8 + depth * 16}px`;

            // 展开/折叠箭头
            if (hasChildren) {
                const chevron = item.createSpan({ cls: `def-folder-chevron ${isCollapsed ? '' : 'expanded'}` });
                this.setIconWithLabel(chevron, isCollapsed ? 'chevron-right' : 'chevron-down');
                chevron.addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (isCollapsed) {
                        this.collapsedFolders.delete(node.path);
                    } else {
                        this.collapsedFolders.add(node.path);
                    }
                    this.renderFolderSidebar(sidebar);
                });
            } else {
                // 无子项时占位，保持对齐
                item.createSpan({ cls: "def-folder-chevron-placeholder" });
            }

            // 文件夹名
            const nameSpan = item.createSpan({ cls: "def-folder-item-name", text: node.name });
            nameSpan.setAttribute("title", node.path || node.name);

            // 计数
            item.createSpan({ cls: "def-folder-count", text: `${node.count}` });

            // 点击选中
            item.addEventListener("click", () => {
                this.selectedFolder = this.selectedFolder === node.path ? null : node.path;
                this.applyFolderFilter();
                this.updateDefinitionList();
                this.renderFolderSidebar(sidebar);
            });

            // 递归渲染子项
            if (hasChildren && !isCollapsed) {
                this.renderFolderTreeNodes(container, node.children, depth + 1, sidebar);
            }
        }
    }

    protected applyFolderFilter() {
        this.applyFilters();
    }

	// 创建管理器工具栏（简化版，只包含管理器功能）
	protected createManagerToolbar(container: Element) {
		const topControls = container.createDiv({ cls: "def-manager-top" });
		const toolbar = topControls.createDiv({ cls: "def-manager-toolbar" });

		/* 1. Search */
		const searchContainer = toolbar.createDiv({ cls: "search-input-container def-manager-search" });
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
		searchInput.addEventListener("input", (e) => {
			debouncedSearch((e.target as HTMLInputElement).value);
		});

		/* 2. Type dropdown */
		const sortControls = toolbar.createDiv({ cls: "def-sort-controls" });

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
		typeDropdown.setValue(this.selectedFileType ?? "all");

		typeDropdown.onChange(async (value) => {
			if (this.selectedFileType === value) return;
			this.selectedFileType = value;
			await this.loadDefinitions();
			this.updateDefinitionList();
		});

		/* 4. Sort dropdown */
		const sortOptions = [
			{ key: "name", order: "asc", label: t("File name (A–Z)") },
			{ key: "name", order: "desc", label: t("File name (Z–A)") },
			{ key: "occurrences", order: "desc", label: t("Occurrences (high to low)") },
			{ key: "occurrences", order: "asc", label: t("Occurrences (low to high)") },
			{ key: "modified", order: "desc", label: t("Modified (newest first)") },
			{ key: "modified", order: "asc", label: t("Modified (oldest first)") },
			{ key: "created", order: "desc", label: t("Created (newest first)") },
			{ key: "created", order: "asc", label: t("Created (oldest first)") },
		];

		const sortDropdown = new DropdownComponent(sortControls);
		sortDropdown.selectEl.addClass("def-sort-dropdown");
		sortOptions.forEach(item => {
			sortDropdown.addOption(`${item.key}:${item.order}`, item.label);
		});

		const setSortDropdown = () => {
			const current = `${this.sortBy}:${this.sortOrder}`;
			const fallback = "name:asc";
			sortDropdown.setValue(
				sortOptions.some(o => `${o.key}:${o.order}` === current) ? current : fallback
			);
		};
		setSortDropdown();

		sortDropdown.onChange((value) => {
			const [key, order] = value.split(":");
			this.sortBy = key;
			this.sortOrder = order;
			this.applyFilters();
			this.updateDefinitionList();
		});

		/* 5. Toggle all */
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

		const toggleDefinitions = (expand: boolean) => {
			const cards = container.querySelectorAll(".def-card-definition");
			cards.forEach(defEl => {
				const isExpanded = (defEl as HTMLElement).getAttribute("data-expanded") === "true";
				if (expand !== isExpanded) {
					defEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
				}
			});
		};

		toggleAllBtn.addEventListener("click", () => {
			expandAll = !expandAll;
			updateToggleBtn();
			toggleDefinitions(expandAll);
			this.scheduleRelayout();
		});

		// 布局切换按钮：瀑布流 vs 图库浏览
		if (!this.managerOnly) {
			const layoutBtn = actions.createEl("button", { cls: "def-toolbar-btn icon-only" });
			this.updateLayoutButton(layoutBtn);
			layoutBtn.addEventListener("click", () => {
				this.viewLayout = this.viewLayout === 'masonry' ? 'gallery' : 'masonry';
				this.updateLayoutButton(layoutBtn);
				this.galleryIndex = 0;
				this.updateDefinitionList();
			});
		}

		// 导出按钮
		// const exportBtn = toolbar.createEl("button", {
		// 	cls: "def-toolbar-btn"
		// });
		// this.setIconWithLabel(exportBtn, "upload", "Export");
		// exportBtn.addEventListener('click', async () => {
		// 	await this.exportDefinitions();
		// });

		// 批量删除按钮
		// const batchDeleteBtn = toolbar.createEl("button", {
		// 	cls: "def-toolbar-btn def-toolbar-btn-danger"
		// });
		// this.setIconWithLabel(batchDeleteBtn, "trash-2");
		// batchDeleteBtn.addEventListener('click', async () => {
		// 	await this.showBatchDeleteModal();
		// });
	}

    private updateLayoutButton(btn: HTMLElement) {
        if (this.viewLayout === 'masonry') {
            this.setIconWithLabel(btn, "layout-grid");
            btn.setAttribute("aria-label", t("Switch to gallery view"));
            btn.title = t("Switch to gallery view");
        } else {
            this.setIconWithLabel(btn, "gallery-horizontal");
            btn.setAttribute("aria-label", t("Switch to masonry view"));
            btn.title = t("Switch to masonry view");
        }
    }

    protected createDefinitionList(container: Element) {
        const listClass = this.managerOnly ? "def-sidebar-list" : "def-manager-list";
        const listContainer = container.createDiv({ cls: listClass });
        this.updateDefinitionList(listContainer);
    }

	protected createSidebarDefinitionList(container: Element) {
        const listContainer = container.createDiv({ cls: "def-sidebar-list" });
        this.updateDefinitionList(listContainer);
    }

	protected updateDefinitionList(listContainer?: Element) {
		const list = listContainer || this.containerEl.querySelector(this.managerOnly ? '.def-sidebar-list' : '.def-manager-list');
		if (!list) return;

		// 清理 gallery 模式残留的类和样式
		list.removeClass("def-gallery-container");
		(list as HTMLElement).style.height = '';

		list.empty();

        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.loadingSentinel = null;

		if (this.filteredDefinitions.length === 0) {
			const empty = list.createDiv({ cls: "def-manager-empty" });
			const emptyIcon = empty.createDiv({ cls: "def-empty-icon" });
			setIcon(emptyIcon, "file-question");
			empty.createDiv({ text: t("No definitions found"), cls: "def-empty-title" });
			empty.createDiv({ text: t("Try adjusting your search or filters"), cls: "def-empty-subtitle" });
			return;
		}

		if (this.viewLayout === 'gallery' && !this.managerOnly) {
			this.renderGalleryView(list as HTMLElement);
		} else {
			this.page = 1;
			this.renderBatch(list as HTMLElement, 0);
		}
	}

    protected renderGalleryView(list: HTMLElement) {
        list.addClass("def-gallery-container");
        list.empty();

        if (this.galleryIndex >= this.filteredDefinitions.length) {
            this.galleryIndex = 0;
        }

        // 主卡片显示区域
        const mainCardArea = list.createDiv({ cls: "def-gallery-main" });

        // 导航按钮
        const navArea = list.createDiv({ cls: "def-gallery-nav" });
        const prevBtn = navArea.createEl("button", { cls: "def-gallery-nav-btn" });
        this.setIconWithLabel(prevBtn, "chevron-left");
        prevBtn.setAttribute("aria-label", t("Previous"));

        const counter = navArea.createEl("span", { cls: "def-gallery-counter" });

        const nextBtn = navArea.createEl("button", { cls: "def-gallery-nav-btn" });
        this.setIconWithLabel(nextBtn, "chevron-right");
        nextBtn.setAttribute("aria-label", t("Next"));

        // 缩略图列表容器
        const thumbStrip = list.createDiv({ cls: "def-gallery-thumbs" });

        // 分块异步渲染缩略图，避免大量 DOM 一次性阻塞主线程
        const CHUNK_SIZE = 50;
        const renderThumbChunk = (startIndex: number) => {
            const endIndex = Math.min(startIndex + CHUNK_SIZE, this.filteredDefinitions.length);
            for (let index = startIndex; index < endIndex; index++) {
                const def = this.filteredDefinitions[index];
                const thumb = thumbStrip.createDiv({
                    cls: `def-gallery-thumb ${index === this.galleryIndex ? 'active' : ''}`
                });

                const thumbWord = thumb.createDiv({ cls: "def-gallery-thumb-word" });
                thumbWord.setText(def.word);

                const thumbPreview = thumb.createDiv({ cls: "def-gallery-thumb-preview" });
                const previewText = def.definition.substring(0, 80).replace(/[#*`]/g, '');
                thumbPreview.setText(previewText + (def.definition.length > 80 ? '...' : ''));

                thumb.addEventListener("click", () => {
                    this.galleryIndex = index;
                    this.updateGallerySelection(mainCardArea, counter, prevBtn, nextBtn, thumbStrip);
                });
            }

            // 还有更多缩略图，下一帧继续
            if (endIndex < this.filteredDefinitions.length) {
                requestAnimationFrame(() => renderThumbChunk(endIndex));
            }
        };

        // 更新选中状态的局部方法
        const goTo = (delta: number) => {
            const newIndex = this.galleryIndex + delta;
            if (newIndex >= 0 && newIndex < this.filteredDefinitions.length) {
                this.galleryIndex = newIndex;
                this.updateGallerySelection(mainCardArea, counter, prevBtn, nextBtn, thumbStrip);
            }
        };

        prevBtn.addEventListener("click", () => goTo(-1));
        nextBtn.addEventListener("click", () => goTo(1));

        // 先渲染主卡片（用户立即看到内容），缩略图分块异步渲染
        this.updateGallerySelection(mainCardArea, counter, prevBtn, nextBtn, thumbStrip);
        requestAnimationFrame(() => renderThumbChunk(0));
    }

    private async updateGallerySelection(
        mainCardArea: HTMLElement,
        counter: HTMLElement,
        prevBtn: HTMLButtonElement,
        nextBtn: HTMLButtonElement,
        thumbStrip: HTMLElement
    ) {
        // 更新主卡片
        mainCardArea.empty();
        const currentDef = this.filteredDefinitions[this.galleryIndex];
        if (currentDef) {
            await this.createGalleryMainCard(mainCardArea, currentDef);
        }

        // 更新计数器
        counter.setText(`${this.galleryIndex + 1} / ${this.filteredDefinitions.length}`);

        // 更新按钮状态
        prevBtn.disabled = this.galleryIndex === 0;
        nextBtn.disabled = this.galleryIndex >= this.filteredDefinitions.length - 1;

        // 更新缩略图激活状态（只切换新旧两个，不全量遍历）
        const prevActive = thumbStrip.querySelector('.def-gallery-thumb.active') as HTMLElement | null;
        if (prevActive) {
            prevActive.removeClass('active');
        }
        // 直接通过 index 定位当前缩略图
        const currentThumb = thumbStrip.children[this.galleryIndex] as HTMLElement | undefined;
        if (currentThumb && currentThumb.addClass) {
            currentThumb.addClass('active');
        }

        // 横向滚动缩略图条到选中项（不影响纵向滚动）
        const activeThumb = thumbStrip.querySelector('.def-gallery-thumb.active') as HTMLElement | null;
        if (activeThumb) {
            const targetLeft = activeThumb.offsetLeft - thumbStrip.clientWidth / 2 + activeThumb.clientWidth / 2;
            thumbStrip.scrollTo({ left: targetLeft, behavior: 'smooth' });
        }
    }

    private async createGalleryMainCard(container: HTMLElement, def: DefinitionWithSource): Promise<HTMLElement> {
        const card = container.createDiv({ cls: "def-gallery-card" });

        // 头部
        const header = card.createDiv({ cls: "def-gallery-card-header" });
        const wordEl = header.createEl("h2", { cls: "def-gallery-card-word" });
        wordEl.innerHTML = this.highlightText(def.word, this.searchTerm);

        // 操作按钮
        const actions = header.createDiv({ cls: "def-gallery-card-actions" });

        const editBtn = actions.createEl("button", { cls: "def-card-action-btn" });
        this.setIconWithLabel(editBtn, "pencil");
        editBtn.setAttribute("aria-label", t("Edit"));
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.editDefinition(def);
        });

        const viewBtn = actions.createEl("button", { cls: "def-card-action-btn" });
        this.setIconWithLabel(viewBtn, "file-symlink");
        viewBtn.setAttribute("aria-label", t("View file"));
        viewBtn.addEventListener('click', () => this.openSourceFile(def));

        const deleteBtn = actions.createEl("button", { cls: "def-card-action-btn" });
        this.setIconWithLabel(deleteBtn, "trash-2");
        deleteBtn.setAttribute("aria-label", t("Delete"));
        deleteBtn.style.color = "red";
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteDefinition(def);
        });

        // 别名
        if (def.aliases.length > 0) {
            const aliasesContainer = card.createDiv({ cls: "def-gallery-card-aliases" });
            def.aliases.forEach(alias => {
                const aliasEl = aliasesContainer.createSpan({ cls: "def-card-alias" });
                aliasEl.innerHTML = this.highlightText(String(alias), this.searchTerm);
            });
        }

        // 完整定义
        const definitionEl = card.createDiv({ cls: "def-gallery-card-definition" });
        const galleryComponent = new Component();
        await MarkdownRenderer.render(
            this.app,
            def.definition,
            definitionEl,
            def.sourceFile.path,
            galleryComponent
        );

        // 文件信息
        const fileInfo = card.createDiv({ cls: "def-gallery-card-info" });
        fileInfo.createSpan({ text: `📁 ${def.sourceFile.name}` });
        fileInfo.appendText(" · ");
        fileInfo.createSpan({ text: def.fileType === DefFileType.Atomic ? t("Atomic") : t("Consolidated") });

        return card;
    }

    protected renderBatch(list: HTMLElement, startIndex: number) {
        const batch = this.filteredDefinitions.slice(startIndex, startIndex + this.pageSize);
        const cards: HTMLElement[] = [];

        batch.forEach(def => {
            const card = this.createDefinitionCard(list, def);
            cards.push(card);
        });

        this.waitForCardsToRender(cards).then(() => {
            if (startIndex === 0) {
                // First batch: full layout
                const allCards = Array.from(list.querySelectorAll('.def-card')) as HTMLElement[];
                this.layoutMasonry(list, allCards);
            } else {
                // Incremental: only position new cards, preserve existing column heights
                this.layoutMasonryIncremental(list, cards);
            }

            // Setup lazy loading if more items exist
            if (startIndex + this.pageSize < this.filteredDefinitions.length) {
                this.setupLazyLoading(list);
            }
        });
    }

    protected setupLazyLoading(list: HTMLElement) {
        if (this.loadingSentinel) {
            this.loadingSentinel.remove();
            this.loadingSentinel = null;
        }
        
        this.loadingSentinel = list.createDiv({ cls: "def-loading-sentinel" });
        this.loadingSentinel.style.height = "20px";
        this.loadingSentinel.style.width = "100%";
        
        // Position at bottom
        const currentHeight = parseFloat(list.style.height || "0");
        this.loadingSentinel.style.position = 'absolute';
        this.loadingSentinel.style.top = `${currentHeight}px`;
        list.style.height = `${currentHeight + 40}px`;
        
        if (!this.observer) {
            this.observer = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting) {
                    this.loadNextBatch(list);
                }
            }, { root: list, rootMargin: '200px' });
        }
        
        this.observer.observe(this.loadingSentinel);
    }

    protected loadNextBatch(list: HTMLElement) {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.page++;
        const startIndex = (this.page - 1) * this.pageSize;
        this.renderBatch(list, startIndex);
    }

    // 等待所有卡片的异步Markdown渲染完成
    protected async waitForCardsToRender(cards: HTMLElement[]): Promise<void> {
        const renderPromises = cards
            .map(card => (card as any)._renderPromise as Promise<void> | undefined)
            .filter((p): p is Promise<void> => !!p);
        await Promise.all(renderPromises);
    }

	// 瀑布流布局核心方法
	private layoutMasonry(container: HTMLElement, cards: HTMLElement[]) {
		if (!this.isViewActive || cards.length === 0) return;

		// 计算容器宽度和列数
		const computed = window.getComputedStyle(container);
		const paddingLeft = parseFloat(computed.paddingLeft) || 0;
		const paddingRight = parseFloat(computed.paddingRight) || 0;
		const paddingTop = parseFloat(computed.paddingTop) || 0;
		const paddingBottom = parseFloat(computed.paddingBottom) || 0;
		const containerWidth = Math.max(200, container.clientWidth - paddingLeft - paddingRight);
		this.calculateColumns(containerWidth);

        // 初始化列高度数组
        this.columnHeights = new Array(this.columnCount).fill(0);

        // 为每个卡片计算位置
        cards.forEach((card, index) => {
            // 找到最短的列
            const shortestColumnIndex = this.getShortestColumnIndex();

            // 计算卡片位置
            const x = shortestColumnIndex * (this.cardWidth + this.gap);
            const y = this.columnHeights[shortestColumnIndex];

            // 获取当前卡片高度（在相对定位状态下）
            const cardHeight = card.offsetHeight;

			// 切换到绝对定位并设置位置
			card.style.position = 'absolute';
			card.style.left = `${paddingLeft + x}px`;
			card.style.top = `${paddingTop + y}px`;
			card.style.width = `${this.cardWidth}px`;
			card.style.marginBottom = '0';

            // 更新列高度
            this.columnHeights[shortestColumnIndex] += cardHeight + this.gap;
        });

		// 设置容器高度
		const maxHeight = Math.max(...this.columnHeights);
		container.style.height = `${maxHeight + paddingTop + paddingBottom}px`;

        // Update sentinel position if exists
        if (this.loadingSentinel && container.contains(this.loadingSentinel)) {
             this.loadingSentinel.style.position = 'absolute';
             this.loadingSentinel.style.top = `${maxHeight + paddingTop}px`;
             container.style.height = `${maxHeight + paddingTop + paddingBottom + 40}px`;
        }

        // 设置ResizeObserver监听容器大小变化
        this.setupResizeObserver(container, cards);
    }

    // Incremental layout: position only new cards using existing columnHeights
    private layoutMasonryIncremental(container: HTMLElement, newCards: HTMLElement[]) {
        if (!this.isViewActive || newCards.length === 0) return;
        if (this.columnHeights.length === 0) {
            // Fallback to full layout if state was lost
            const allCards = Array.from(container.querySelectorAll('.def-card')) as HTMLElement[];
            this.layoutMasonry(container, allCards);
            return;
        }

        const computed = window.getComputedStyle(container);
        const paddingLeft = parseFloat(computed.paddingLeft) || 0;
        const paddingTop = parseFloat(computed.paddingTop) || 0;
        const paddingBottom = parseFloat(computed.paddingBottom) || 0;

        newCards.forEach(card => {
            const shortestColumnIndex = this.getShortestColumnIndex();
            const x = shortestColumnIndex * (this.cardWidth + this.gap);
            const y = this.columnHeights[shortestColumnIndex];
            const cardHeight = card.offsetHeight;

            card.style.position = 'absolute';
            card.style.left = `${paddingLeft + x}px`;
            card.style.top = `${paddingTop + y}px`;
            card.style.width = `${this.cardWidth}px`;
            card.style.marginBottom = '0';

            this.columnHeights[shortestColumnIndex] += cardHeight + this.gap;
        });

        const maxHeight = Math.max(...this.columnHeights);
        container.style.height = `${maxHeight + paddingTop + paddingBottom}px`;

        if (this.loadingSentinel && container.contains(this.loadingSentinel)) {
            this.loadingSentinel.style.position = 'absolute';
            this.loadingSentinel.style.top = `${maxHeight + paddingTop}px`;
            container.style.height = `${maxHeight + paddingTop + paddingBottom + 40}px`;
        }
    }

    // 计算列数和卡片宽度
    private calculateColumns(containerWidth: number) {
        // 定义不同屏幕尺寸的最小卡片宽度
        let minCardWidth: number;
        let maxColumns: number;

        if (containerWidth < 600) {
            // 小屏幕：1-2列
            minCardWidth = 180;
            maxColumns = 2;
        } else if (containerWidth < 900) {
            // 中等屏幕：2-3列
            minCardWidth = 220;
            maxColumns = 3;
        } else if (containerWidth < 1200) {
            // 大屏幕：3-4列
            minCardWidth = 240;
            maxColumns = 4;
        } else if (containerWidth < 1600) {
            // 超大屏幕：4-5列
            minCardWidth = 260;
            maxColumns = 5;
        } else {
            // 超宽屏：5-6列
            minCardWidth = 280;
            maxColumns = 6;
        }

        // 计算最佳列数
        this.columnCount = Math.floor((containerWidth + this.gap) / (minCardWidth + this.gap));
        this.columnCount = Math.min(this.columnCount, maxColumns);
        this.columnCount = Math.max(1, this.columnCount);

        // 根据列数计算实际卡片宽度，充分利用可用空间
        this.cardWidth = (containerWidth - (this.columnCount - 1) * this.gap) / this.columnCount;

        // 确保卡片宽度不小于最小值
        if (this.cardWidth < minCardWidth) {
            this.columnCount = Math.max(1, this.columnCount - 1);
            this.cardWidth = (containerWidth - (this.columnCount - 1) * this.gap) / this.columnCount;
        }
    }

    // 找到最短的列
    private getShortestColumnIndex(): number {
        let shortestIndex = 0;
        let shortestHeight = this.columnHeights[0];

        for (let i = 1; i < this.columnHeights.length; i++) {
            if (this.columnHeights[i] < shortestHeight) {
                shortestHeight = this.columnHeights[i];
                shortestIndex = i;
            }
        }

        return shortestIndex;
    }

    	// 设置ResizeObserver
	private setupResizeObserver(container: HTMLElement, cards: HTMLElement[]) {
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
		}

		// 检查视图是否仍然活跃
		if (!this.isViewActive || !this.containerEl.isConnected) {
			return;
		}

		this.resizeObserver = new ResizeObserver((entries) => {
			// 检查视图是否仍然活跃
			if (!this.isViewActive || !this.containerEl.isConnected) {
				return;
			}
			
			// 防抖处理，避免频繁重新布局
			clearTimeout(this.resizeTimeout);
			this.resizeTimeout = setTimeout(() => {
				// 再次检查视图是否仍然活跃
				if (!this.isViewActive || !this.containerEl.isConnected) {
					return;
				}
				// 重新计算布局
				this.layoutMasonry(container, cards);
			}, 100);
		});

		this.resizeObserver.observe(container);

		// 同时监听窗口大小变化
		this.setupWindowResizeListener(container, cards);
	}

    private resizeTimeout?: NodeJS.Timeout;

    	// 监听窗口大小变化
	private setupWindowResizeListener(container: HTMLElement, cards: HTMLElement[]) {
		const handleResize = () => {
			// 检查视图是否仍然活跃
			if (!this.isViewActive || !this.containerEl.isConnected) {
				return;
			}
			
			clearTimeout(this.resizeTimeout);
			this.resizeTimeout = setTimeout(() => {
				// 再次检查视图是否仍然活跃
				if (!this.isViewActive || !this.containerEl.isConnected) {
					return;
				}
				this.layoutMasonry(container, cards);
			}, 100);
		};

		window.addEventListener('resize', handleResize);

		// 清理函数
		this.cleanupResizeListener = () => {
			window.removeEventListener('resize', handleResize);
		};
	}

    private cleanupResizeListener?: () => void;

    protected createDefinitionCard(container: Element, def: DefinitionWithSource): HTMLElement {
        const card = container.createDiv({ cls: "def-card" });

        // 初始时设置为相对定位，等待布局完成后改为绝对定位
        card.style.position = 'relative';
        card.style.width = '100%';
        card.style.marginBottom = '8px';

        // 添加随机的视觉变化（小红书风格）
        if (this.allowRandomStyle) {
            const randomClass = Math.random() > 0.7 ? 'def-card-featured' : '';
            if (randomClass) {
                card.addClass(randomClass);
            }
        }

        // 卡片头部
        const header = card.createDiv({ cls: "def-card-header" });
        const wordEl = header.createEl("h3", { cls: "def-card-word" });
		wordEl.innerHTML = this.highlightText(def.word, this.searchTerm);

		// 操作按钮
		const actions = header.createDiv({ cls: "def-card-actions" });

		const editBtn = actions.createEl("button", {
			cls: "def-card-action-btn"
		});
		this.setIconWithLabel(editBtn, "pencil");
		editBtn.setAttribute("aria-label", t("Edit"));
		editBtn.title = t("Edit");
		editBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.editDefinition(def);
		});

		const viewBtn = actions.createEl("button", {
			cls: "def-card-action-btn"
		});
		this.setIconWithLabel(viewBtn, "file-symlink");
		viewBtn.setAttribute("aria-label", t("View file"));
		viewBtn.title = t("View file");
		viewBtn.addEventListener('click', () => this.openSourceFile(def));

		const deleteBtn = actions.createEl("button", {
			cls: "def-card-action-btn"
		});
		this.setIconWithLabel(deleteBtn, "trash-2");
		deleteBtn.setAttribute("aria-label", t("Delete"));
		deleteBtn.title = t("Delete");
		deleteBtn.style.color = "red";
		deleteBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.deleteDefinition(def);
        });

        // 别名标签 - 放在原来元数据的位置
        const aliasesContainer = card.createDiv({ cls: "def-card-aliases" });
        if (def.aliases.length > 0) {
            // 最多显示3个别名，避免卡片过长
            const displayAliases = def.aliases.slice(0, 3);
            displayAliases.forEach(alias => {
				const aliasEl = aliasesContainer.createSpan({ cls: "def-card-alias" });
				aliasEl.innerHTML = this.highlightText(String(alias), this.searchTerm);
            });

            // 如果有更多别名，显示"+N"
            if (def.aliases.length > 3) {
                const moreSpan = aliasesContainer.createSpan({
                    cls: "def-card-alias def-card-alias-more",
                    text: `+${def.aliases.length - 3}`
                });
                moreSpan.title = def.aliases.slice(3).join(', ');
            }
        } else {
            // 如果没有别名，显示一个占位符
            aliasesContainer.createSpan({
                cls: "def-card-no-aliases",
                text: t("No aliases")
            });
        }

        // 定义内容 - 使用MarkdownRenderer渲染，支持点击折叠/展开（无额外按钮）
        const definitionEl = card.createDiv({ cls: "def-card-definition" });

        const maxLength = 200;
        const hasLongContent = this.enableTruncation && def.definition.length > maxLength;
        const truncatedText = hasLongContent
            ? (() => {
                const cut = def.definition.lastIndexOf('。', maxLength);
                const altCut = def.definition.lastIndexOf('.', maxLength);
                const end = cut >= 0 ? cut + 1 : (altCut >= 0 ? altCut + 1 : maxLength);
                return def.definition.substring(0, end) + "...";
            })()
            : def.definition;

        let expanded = false;
        const applySidebarCardHeight = () => {
            if (!this.managerOnly) return;
            if (expanded) {
                card.classList.remove("def-card-collapsed");
                card.style.height = "auto";
                card.style.overflow = "visible";
            } else {
                card.classList.add("def-card-collapsed");
                card.style.height = "auto";
                card.style.overflow = "hidden";
            }
        };

        let renderComponent: Component | null = null;
        const renderDefinition = async () => {
            if (renderComponent) {
                renderComponent.unload();
            }
            definitionEl.empty();
            renderComponent = new Component();
            await MarkdownRenderer.render(
                this.app,
                expanded || !hasLongContent ? def.definition : truncatedText,
                definitionEl,
                def.sourceFile.path,
                renderComponent
            );

            if (hasLongContent) {
                definitionEl.style.cursor = 'pointer';
                definitionEl.title = expanded ? t("Click to collapse") : t("Click to expand");
            } else {
                definitionEl.style.cursor = 'default';
                definitionEl.title = '';
            }

            definitionEl.setAttr('data-expanded', expanded ? 'true' : 'false');
            applySidebarCardHeight();
        };

        const renderPromise = renderDefinition();
        (card as any)._renderPromise = renderPromise;

        const toggleExpand = () => {
            expanded = !expanded;
            renderDefinition();
			this.scheduleRelayout();
        };

        if (hasLongContent) {
            definitionEl.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleExpand();
            });
        }

        // Sidebar cards: clicking the card toggles expanded/collapsed to reveal definition
        card.addEventListener('click', (e) => {
            // avoid double toggle from inner buttons
            if ((e.target as HTMLElement)?.closest(".def-card-action-btn")) return;
            toggleExpand();
        });

        // 时间信息
        const timeInfo = card.createDiv({ cls: "def-card-time-info" });
        const createdTime = new Date(def.sourceFile.stat.ctime).toLocaleDateString(getLocale());
        const modifiedTime = new Date(def.sourceFile.stat.mtime).toLocaleDateString(getLocale());

        timeInfo.createSpan({
            cls: "def-card-time-item",
            text: t("Created: {{date}}", { date: createdTime })
        });
        timeInfo.createSpan({
            cls: "def-card-time-item",
            text: t("Modified: {{date}}", { date: modifiedTime })
        });

        return card;
    }

	// 使用现有的EditDefinitionModal
	private async editDefinition(def: DefinitionWithSource) {
		try {
			// 创建正确的Definition对象传递给EditDefinitionModal
			const defForEdit: Definition = {
				key: def.key,
				word: def.word,
				aliases: def.aliases,
				definition: def.definition,
				file: def.sourceFile,
				linkText: def.linkText,
				fileType: def.fileType,
				position: def.position
			};
			
			const editModal = new EditDefinitionModal(this.app);
			editModal.open(defForEdit);
			
			// 标记是否点击了保存按钮
			let savedChanges = false;
			
			// 监听保存按钮点击事件
			const saveButton = editModal.modal.contentEl.querySelector('.edit-modal-save-button') as HTMLButtonElement;
			if (saveButton) {
				const originalClickHandler = saveButton.onclick;
				saveButton.onclick = (e) => {
					savedChanges = true;
					if (originalClickHandler) {
						originalClickHandler.call(saveButton, e);
					}
				};
			}
			
			// 监听模态窗口关闭事件，只在点击保存时才刷新列表
			editModal.modal.onClose = async () => {
			if (savedChanges) {
				await this.loadDefinitions();
				this.updateDefinitionList();
			}
		};
			
		} catch (error) {
			console.error('Error in editDefinition:', error);
			const message = error instanceof Error ? error.message : String(error);
			new Notice(t("Failed to open edit dialog: {{error}}", { error: message }));
		}
	}

    private async deleteDefinition(def: DefinitionWithSource) {
        const confirmModal = new Modal(this.app);
        confirmModal.setTitle(t("Confirm deletion"));

        const content = confirmModal.contentEl;
        content.createEl("p", { text: t("Are you sure you want to delete the definition for \"{{word}}\"?", { word: def.word }) });
        content.createEl("p", {
            text: t("This action cannot be undone."),
            cls: "mod-warning"
        });

        const buttonContainer = content.createDiv();
        buttonContainer.style.display = "flex";
        buttonContainer.style.justifyContent = "flex-end";
        buttonContainer.style.gap = "10px";
        buttonContainer.style.marginTop = "20px";

        const cancelBtn = buttonContainer.createEl("button", { text: t("Cancel") });
        cancelBtn.addEventListener('click', () => confirmModal.close());

        const deleteBtn = buttonContainer.createEl("button", { text: t("Delete") });
        deleteBtn.addClass("mod-warning");
        deleteBtn.addEventListener('click', async () => {
            try {
                const updater = new DefFileUpdater(this.app);

                // 创建正确的Definition对象进行删除
                const defToDelete: Definition = {
                    key: def.key,
                    word: def.word,
                    aliases: def.aliases,
                    definition: def.definition,
                    file: def.sourceFile,
                    linkText: def.word,
                    fileType: def.fileType,
                    position: def.position
                };

                await updater.deleteDefinition(defToDelete);

                confirmModal.close();

                // 刷新列表
                await this.loadDefinitions();
                this.updateDefinitionList();

            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                new Notice(t("Failed to delete definition: {{error}}", { error: message }));
            }
        });

        confirmModal.open();
    }

    private async openSourceFile(def: DefinitionWithSource) {
        const leaf = this.app.workspace.getLeaf();
        await leaf.openFile(def.sourceFile);
    }

    private async exportDefinitions() {
        const exportModal = new Modal(this.app);
        exportModal.setTitle(t("Export definitions"));

        const content = exportModal.contentEl;

        // 导出格式选择
        let exportFormat = 'json';
        new Setting(content)
            .setName(t("Export format"))
            .setDesc(t("Choose the format for exporting definitions"))
            .addDropdown(component => {
                component.addOption('json', 'JSON');
                component.addOption('csv', 'CSV');
                component.addOption('markdown', 'Markdown');
                component.setValue(exportFormat);
                component.onChange(value => {
                    exportFormat = value;
                });
            });

        // 导出范围选择
        let exportScope = 'filtered';
        new Setting(content)
            .setName(t("Export scope"))
            .setDesc(t("Choose which definitions to export"))
            .addDropdown(component => {
                component.addOption('filtered', t("Current filter ({{count}} definitions)", { count: this.filteredDefinitions.length }));
                component.addOption('all', t("All definitions ({{count}} definitions)", { count: this.definitions.length }));
                component.setValue(exportScope);
                component.onChange(value => {
                    exportScope = value;
                });
            });

        // 按钮
        const buttonContainer = content.createDiv();
        buttonContainer.style.display = "flex";
        buttonContainer.style.justifyContent = "flex-end";
        buttonContainer.style.gap = "10px";
        buttonContainer.style.marginTop = "20px";

        const cancelBtn = buttonContainer.createEl("button", { text: t("Cancel") });
        cancelBtn.addEventListener('click', () => exportModal.close());

        const exportBtn = buttonContainer.createEl("button", { text: t("Export") });
        exportBtn.addClass("mod-cta");
        exportBtn.addEventListener('click', () => {
            const defsToExport = exportScope === 'all' ? this.definitions : this.filteredDefinitions;
            this.performExport(defsToExport, exportFormat);
            exportModal.close();
        });

        exportModal.open();
    }

    private performExport(definitions: DefinitionWithSource[], format: string) {
        let content = '';
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');

        switch (format) {
            case 'json':
                const jsonData = definitions.map(def => ({
                    word: def.word,
                    aliases: def.aliases,
                    definition: def.definition,
                    fileType: def.fileType,
                    sourceFile: def.sourceFile.name,
                    filePath: def.filePath
                }));
                content = JSON.stringify(jsonData, null, 2);
                this.downloadFile(`definitions-${timestamp}.json`, content, 'application/json');
                break;

            case 'csv':
                const csvHeaders = [t("Word"), t("Aliases"), t("Definition"), t("File type"), t("Source file")];
                const csvRows = definitions.map(def => [
                    def.word,
                    def.aliases.join('; '),
                    def.definition.replace(/"/g, '""').replace(/\n/g, ' '),
                    def.fileType,
                    def.sourceFile.name
                ]);
                content = [csvHeaders, ...csvRows]
                    .map(row => row.map(cell => `"${cell}"`).join(','))
                    .join('\n');
                this.downloadFile(`definitions-${timestamp}.csv`, content, 'text/csv');
                break;

            case 'markdown':
                content = `# ${t("Exported definitions")}\n\n`;
                content += `${t("Exported on: {{date}}", { date: new Date().toLocaleString(getLocale()) })}\n`;
                content += `${t("Total definitions: {{count}}", { count: definitions.length })}\n\n`;

                definitions.forEach(def => {
                    content += `## ${def.word}\n\n`;
                    if (def.aliases.length > 0) {
                        content += `**${t("Aliases")}:** ${def.aliases.join(', ')}\n\n`;
                    }
                    content += `**${t("Definition")}:** ${def.definition}\n\n`;
                    const typeLabel = def.fileType === DefFileType.Atomic ? t("Atomic") : t("Consolidated");
                    content += `**${t("Source")}:** ${def.sourceFile.name} (${typeLabel})\n\n`;
                    content += '---\n\n';
                });
                this.downloadFile(`definitions-${timestamp}.md`, content, 'text/markdown');
                break;
        }

        new Notice(t("Exported {{count}} definitions as {{format}}", {
            count: definitions.length,
            format: format.toUpperCase()
        }));
    }

    private downloadFile(filename: string, content: string, mimeType: string) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    private async showBatchDeleteModal() {
        const batchModal = new Modal(this.app);
        batchModal.setTitle(t("Batch delete definitions"));

        const content = batchModal.contentEl;

        // 警告信息
		const warning = content.createDiv({ cls: "mod-warning" });
		warning.style.padding = "15px";
		warning.style.marginBottom = "20px";
		warning.style.borderRadius = "5px";
		const warningTitle = warning.createDiv({ cls: "with-icon warning-title" });
		this.setIconWithLabel(warningTitle, "alert-triangle", t("Warning:"));
		warning.createDiv({ text: t("This action will permanently delete the selected definitions.") });
		warning.createDiv({ text: t("For atomic definitions, the entire file will be deleted.") });
		warning.createDiv({ text: t("This action cannot be undone.") });

        // 删除选项
        let deleteOption = 'filtered';
        new Setting(content)
            .setName(t("Delete scope"))
            .setDesc(t("Choose which definitions to delete"))
            .addDropdown(component => {
                component.addOption('filtered', t("Current filter ({{count}} definitions)", { count: this.filteredDefinitions.length }));
                component.addOption('file', t("By source file"));
                component.addOption('type', t("By file type"));
                component.setValue(deleteOption);
                component.onChange(value => {
                    deleteOption = value;
                    this.updateBatchDeleteOptions(optionsContainer, deleteOption);
                });
            });

        // 动态选项容器
        const optionsContainer = content.createDiv({ cls: "batch-delete-options" });
        this.updateBatchDeleteOptions(optionsContainer, deleteOption);

        // 按钮
        const buttonContainer = content.createDiv();
        buttonContainer.style.display = "flex";
        buttonContainer.style.justifyContent = "flex-end";
        buttonContainer.style.gap = "10px";
        buttonContainer.style.marginTop = "20px";

        const cancelBtn = buttonContainer.createEl("button", { text: t("Cancel") });
        cancelBtn.addEventListener('click', () => batchModal.close());

        const deleteBtn = buttonContainer.createEl("button", { text: t("Delete selected") });
        deleteBtn.addClass("mod-warning");
        deleteBtn.addEventListener('click', () => {
            this.performBatchDelete(deleteOption, optionsContainer);
            batchModal.close();
        });

        batchModal.open();
    }

    private updateBatchDeleteOptions(container: Element, option: string) {
        container.empty();

        switch (option) {
            case 'file':
                const uniqueFiles = new Set(this.definitions.map(def => def.filePath));
                Array.from(uniqueFiles).sort().forEach(filePath => {
                    const fileName = filePath.split('/').pop() || filePath;
                    const fileDefCount = this.definitions.filter(def => def.filePath === filePath).length;

                    const checkbox = container.createEl("label");
                    checkbox.style.display = "block";
                    checkbox.style.marginBottom = "8px";
                    const input = checkbox.createEl("input", { type: "checkbox", value: filePath });
                    input.style.marginRight = "8px";
                    checkbox.createSpan({ text: t("{{name}} ({{count}} definitions)", { name: fileName, count: fileDefCount }) });
                });
                break;

            case 'type':
                const typeOptions = [
                    { value: DefFileType.Consolidated, label: t("Consolidated") },
                    { value: DefFileType.Atomic, label: t("Atomic") }
                ];

                typeOptions.forEach(type => {
                    const typeDefCount = this.definitions.filter(def => def.fileType === type.value).length;
                    if (typeDefCount > 0) {
                        const checkbox = container.createEl("label");
                        checkbox.style.display = "block";
                        checkbox.style.marginBottom = "8px";
                        const input = checkbox.createEl("input", { type: "checkbox", value: type.value });
                        input.style.marginRight = "8px";
                        checkbox.createSpan({ text: t("{{name}} ({{count}} definitions)", { name: type.label, count: typeDefCount }) });
                    }
                });
                break;
        }
    }

    private async performBatchDelete(option: string, optionsContainer: Element) {
        let defsToDelete: DefinitionWithSource[] = [];

        switch (option) {
            case 'filtered':
                defsToDelete = [...this.filteredDefinitions];
                break;

            case 'file':
                const selectedFiles = Array.from(optionsContainer.querySelectorAll('input[type="checkbox"]:checked'))
                    .map(input => (input as HTMLInputElement).value);
                defsToDelete = this.definitions.filter(def => selectedFiles.includes(def.filePath));
                break;

            case 'type':
                const selectedTypes = Array.from(optionsContainer.querySelectorAll('input[type="checkbox"]:checked'))
                    .map(input => (input as HTMLInputElement).value);
                defsToDelete = this.definitions.filter(def => selectedTypes.includes(def.fileType));
                break;
        }

        if (defsToDelete.length === 0) {
            new Notice(t("No definitions selected for deletion"));
            return;
        }

        // 最终确认
        const confirmModal = new Modal(this.app);
        confirmModal.setTitle(t("Final confirmation"));

        const content = confirmModal.contentEl;
        content.createEl("p", {
            text: t("You are about to delete {{count}} definitions.", { count: defsToDelete.length })
        });
        content.createEl("p", {
            text: t("This action cannot be undone. Are you sure?"),
            cls: "mod-warning"
        });

        const buttonContainer = content.createDiv();
        buttonContainer.style.display = "flex";
        buttonContainer.style.justifyContent = "flex-end";
        buttonContainer.style.gap = "10px";
        buttonContainer.style.marginTop = "20px";

        const cancelBtn = buttonContainer.createEl("button", { text: t("Cancel") });
        cancelBtn.addEventListener('click', () => confirmModal.close());

        const confirmBtn = buttonContainer.createEl("button", { text: t("Delete all") });
        confirmBtn.addClass("mod-warning");
        confirmBtn.addEventListener('click', async () => {
            confirmModal.close();
            await this.executeBatchDelete(defsToDelete);
        });

        confirmModal.open();
    }

    private async executeBatchDelete(definitions: DefinitionWithSource[]) {
        const notice = new Notice(t("Deleting definitions..."), 0);
        const updater = new DefFileUpdater(this.app);
        let successCount = 0;
        let errorCount = 0;

        for (const def of definitions) {
            try {
                const defToDelete: Definition = {
                    key: def.key,
                    word: def.word,
                    aliases: def.aliases,
                    definition: def.definition,
                    file: def.sourceFile,
                    linkText: def.word,
                    fileType: def.fileType,
                    position: def.position
                };
                await updater.deleteDefinition(defToDelete);
                successCount++;
            } catch (error) {
                console.error(`Failed to delete definition ${def.word}:`, error);
                errorCount++;
            }
        }

        notice.hide();

        if (errorCount === 0) {
            new Notice(t("Successfully deleted {{count}} definitions", { count: successCount }));
        } else {
            new Notice(t("Deleted {{success}} definitions, {{failed}} failed", {
                success: successCount,
                failed: errorCount
            }));
        }

		// 刷新列表
		await this.loadDefinitions();
		this.updateDefinitionList();
	}
}
