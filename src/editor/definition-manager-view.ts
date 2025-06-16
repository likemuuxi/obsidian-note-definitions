import { ItemView, WorkspaceLeaf, Notice, Setting, TFile, MarkdownRenderer, Component, Modal } from "obsidian";
import { getDefFileManager } from "src/core/def-file-manager";
import { DefFileUpdater } from "src/core/def-file-updater";
import { DefFileType } from "src/core/file-type";
import { Definition } from "src/core/model";
import { EditDefinitionModal } from "src/editor/edit-modal";
import { ViewMode, getSettings, FlashcardConfig } from "src/settings";
import { FlashcardManager } from "src/core/flashcard-manager";

export const DEFINITION_MANAGER_VIEW_TYPE = "definition-manager-view";

interface DefinitionWithSource extends Definition {
    sourceFile: TFile;
    filePath: string;
}

export class DefinitionManagerView extends ItemView {
    definitions: DefinitionWithSource[] = [];
    filteredDefinitions: DefinitionWithSource[] = [];

    // 筛选和搜索状态
    searchTerm: string = '';
    selectedFileType: string = 'all';
    selectedSourceFile: string = 'all';
    sortBy: string = 'name'; // name, created, modified
    sortOrder: string = 'asc'; // asc, desc

    // 瀑布流布局相关
    private columnCount: number = 0;
    private columnHeights: number[] = [];
    private cardWidth: number = 280;
    private gap: number = 16;
    private resizeObserver?: ResizeObserver;

    // 设置相关
	private enableTruncation: boolean = false;
	private currentViewMode: ViewMode = ViewMode.Manager;
	private flashcardManager?: FlashcardManager;
	
	// 浏览模式相关
	private browseMode: 'flashcard' | 'browse' = 'flashcard';
	private selectedConsolidatedFiles: TFile[] = [];
	private currentBrowseIndex: number = 0;
	private browseDefinitions: Array<{file: TFile, definitions: any[]}> = [];
	private flatBrowseList: Array<{file: TFile, definition: any}> = [];
	private updateSelectedFiles?: () => void;
	private isViewActive: boolean = false;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType() {
        return DEFINITION_MANAGER_VIEW_TYPE;
    }

    getDisplayText() {
        return "Definition Manager";
    }

    getIcon() {
        return "book-open";
    }

    async onOpen() {
        this.isViewActive = true;
        
        // 根据设置确定默认视图模式
        const settings = getSettings();
        const defaultMode = settings.defaultViewMode || 'manager';
        
        if (defaultMode === 'flashcard') {
            this.currentViewMode = ViewMode.Flashcard;
            this.browseMode = 'flashcard';
        } else if (defaultMode === 'browse') {
            this.currentViewMode = ViewMode.Flashcard;
            this.browseMode = 'browse';
        } else {
            this.currentViewMode = ViewMode.Manager;
            this.browseMode = 'flashcard';
        }
        
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

        // 重置状态
        this.isViewActive = false;
        this.currentViewMode = ViewMode.Manager;
        this.browseMode = 'flashcard';
        this.selectedConsolidatedFiles = [];
        this.currentBrowseIndex = 0;
        this.browseDefinitions = [];
        this.flatBrowseList = [];
    }

    private async loadDefinitions() {
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

    private applyFilters() {
        this.filteredDefinitions = this.definitions.filter(def => {
            // 搜索过滤
            if (this.searchTerm) {
                const searchLower = this.searchTerm.toLowerCase();
                const matchesWord = def.word.toLowerCase().includes(searchLower);
                const matchesDefinition = def.definition.toLowerCase().includes(searchLower);
                const matchesAliases = def.aliases.some(alias =>
                    typeof alias === 'string' && alias.toLowerCase().includes(searchLower)
                );
                if (!matchesWord && !matchesDefinition && !matchesAliases) {
                    return false;
                }
            }

            // 文件类型过滤
            if (this.selectedFileType !== 'all' && def.fileType !== this.selectedFileType) {
                return false;
            }

            // 源文件/文件夹过滤
            if (this.selectedSourceFile !== 'all') {
                if (this.selectedFileType === DefFileType.Consolidated) {
                    // Consolidated类型按文件路径过滤
                    if (def.filePath !== this.selectedSourceFile) {
                        return false;
                    }
                } else if (this.selectedFileType === DefFileType.Atomic) {
                    // Atomic类型按文件夹路径过滤
                    const defFolderPath = def.filePath.split('/').slice(0, -1).join('/');
                    if (defFolderPath !== this.selectedSourceFile) {
                        return false;
                    }
                }
                // 注意：当selectedFileType为'all'时，不进行源文件过滤，显示所有类型的定义
            }

            return true;
        });

        // 排序
        this.filteredDefinitions.sort((a, b) => {
            let comparison = 0;

            switch (this.sortBy) {
                case 'name':
                    // 按定义的词语名称排序
                    comparison = a.word.localeCompare(b.word);
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

    	private render() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("def-manager-view-container");
		
		// 默认使用Manager模式
		if (this.currentViewMode === ViewMode.Manager) {
			this.currentViewMode = ViewMode.Manager;
		}
		
		// 创建模式切换按钮
		this.createModeButtons(container);
		
		// 根据当前模式渲染内容
		if (this.currentViewMode === ViewMode.Manager) {
			// Definition Manager模式
			this.createManagerToolbar(container);
			this.createStats(container);
			this.createDefinitionList(container);
		} else if (this.currentViewMode === ViewMode.Statistics) {
			// Statistics Dashboard模式
			this.renderStatisticsView(container);
		} else {
			// 闪卡模式（包含Browse Mode和Flashcard Study）
			this.renderFlashcardView(container);
		}
	}

	// 创建模式切换按钮
	private createModeButtons(container: Element) {
		const modeContainer = container.createDiv({ cls: "mode-buttons-container" });
		
		// Definition Manager按钮 - 放到首位
		const managerBtn = modeContainer.createEl("button", {
			cls: `mode-btn ${this.currentViewMode === ViewMode.Manager ? 'active' : ''}`,
			text: "📋 Definition Manager"
		});
		managerBtn.addEventListener('click', async () => {
			this.currentViewMode = ViewMode.Manager;
			await this.loadDefinitions(); // 重新加载定义数据
			this.render();
		});

		// Flashcard Study按钮
		const flashcardBtn = modeContainer.createEl("button", {
			cls: `mode-btn ${this.currentViewMode === ViewMode.Flashcard && this.browseMode === 'flashcard' ? 'active' : ''}`,
			text: "📚 Flashcard Study"
		});
		flashcardBtn.addEventListener('click', () => {
			this.currentViewMode = ViewMode.Flashcard;
			this.browseMode = 'flashcard';
			this.render();
		});

		// Browse Mode按钮
		const browseBtn = modeContainer.createEl("button", {
			cls: `mode-btn ${this.currentViewMode === ViewMode.Flashcard && this.browseMode === 'browse' ? 'active' : ''}`,
			text: "📖 Browse Mode"
		});
		browseBtn.addEventListener('click', () => {
			this.currentViewMode = ViewMode.Flashcard;
			this.browseMode = 'browse';
			this.render();
		});
	}

	// 创建管理器工具栏（简化版，只包含管理器功能）
	private createManagerToolbar(container: Element) {
		const toolbar = container.createDiv({ cls: "def-manager-toolbar" });

		// 搜索框
		const searchGroup = toolbar.createDiv({ cls: "def-manager-toolbar-group" });
		searchGroup.createSpan({ text: "Search:" });
		const searchInput = searchGroup.createEl("input", {
			cls: "def-manager-search",
			attr: { placeholder: "Search words, definitions, or aliases..." }
		});
		searchInput.value = this.searchTerm;
		searchInput.addEventListener('input', (e) => {
			this.searchTerm = (e.target as HTMLInputElement).value;
			this.applyFilters();
			this.updateDefinitionList();
		});

		// 文件类型筛选
		const typeGroup = toolbar.createDiv({ cls: "def-manager-toolbar-group" });
		typeGroup.createSpan({ text: "Type:" });
		const typeSelect = typeGroup.createEl("select", { cls: "def-manager-select" });
		typeSelect.innerHTML = `
			<option value="all">All Types</option>
			<option value="${DefFileType.Consolidated}">Consolidated</option>
			<option value="${DefFileType.Atomic}">Atomic</option>
		`;
		typeSelect.value = this.selectedFileType;
		typeSelect.addEventListener('change', async (e) => {
			this.selectedFileType = (e.target as HTMLSelectElement).value;
			this.selectedSourceFile = 'all'; // 重置源文件选择
			await this.loadDefinitions(); // 自动刷新数据
			this.updateDefinitionList();
			this.updateFileSelect(fileSelect); // 更新文件选择器
		});

		// 源文件/文件夹筛选
		const fileGroup = toolbar.createDiv({ cls: "def-manager-toolbar-group" });
		const fileLabel = fileGroup.createSpan({ text: "Filter:" });
		const fileSelect = fileGroup.createEl("select", { cls: "def-manager-select" });
		this.updateFileSelect(fileSelect);
		fileSelect.addEventListener('change', (e) => {
			this.selectedSourceFile = (e.target as HTMLSelectElement).value;
			this.applyFilters();
			this.updateDefinitionList();
		});

		// 排序选项
		const sortGroup = toolbar.createDiv({ cls: "def-manager-toolbar-group" });
		sortGroup.createSpan({ text: "Sort:" });
		const sortSelect = sortGroup.createEl("select", { cls: "def-manager-select" });
		sortSelect.innerHTML = `
			<option value="name">Name</option>
			<option value="created">Created Time</option>
			<option value="modified">Modified Time</option>
		`;
		sortSelect.value = this.sortBy;
		sortSelect.addEventListener('change', (e) => {
			this.sortBy = (e.target as HTMLSelectElement).value;
			this.applyFilters();
			this.updateDefinitionList();
		});

		// 排序方向
		const orderBtn = sortGroup.createEl("button", {
			cls: "def-toolbar-btn",
			text: this.sortOrder === 'asc' ? '↑' : '↓'
		});
		orderBtn.addEventListener('click', () => {
			this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
			orderBtn.textContent = this.sortOrder === 'asc' ? '↑' : '↓';
			this.applyFilters();
			this.updateDefinitionList();
		});

		// 按钮组
		const buttonGroup = toolbar.createDiv({ cls: "def-manager-toolbar-group" });
		
		// 折叠设置开关
		const truncateGroup = buttonGroup.createDiv({ cls: "def-manager-toolbar-group" });
		const truncateLabel = truncateGroup.createEl("label", { 
			cls: "def-truncate-toggle",
			text: "Truncate long content"
		});
		const truncateCheckbox = truncateLabel.createEl("input", { 
			type: "checkbox"
		});
		truncateCheckbox.checked = this.enableTruncation;
		truncateCheckbox.addEventListener('change', (e) => {
			this.enableTruncation = (e.target as HTMLInputElement).checked;
			this.updateDefinitionList();
		});



		// 导出按钮
		const exportBtn = buttonGroup.createEl("button", {
			cls: "def-toolbar-btn",
			text: "📤 Export"
		});
		exportBtn.addEventListener('click', async () => {
			await this.exportDefinitions();
		});

		// 批量删除按钮
		const batchDeleteBtn = buttonGroup.createEl("button", {
			cls: "def-toolbar-btn def-toolbar-btn-danger",
			text: "🗑️ Batch Delete"
		});
		batchDeleteBtn.addEventListener('click', async () => {
			await this.showBatchDeleteModal();
		});
	}

    // CSS样式已移动到styles.css文件中

    

    private updateFileSelect(fileSelect: HTMLSelectElement) {
        fileSelect.innerHTML = '';

        if (this.selectedFileType === 'all') {
            // All Types - 不显示过滤器
            fileSelect.style.display = 'none';
            fileSelect.previousElementSibling!.textContent = '';
            return;
        } else {
            fileSelect.style.display = 'block';
        }

        if (this.selectedFileType === DefFileType.Consolidated) {
            // Consolidated类型 - 按文件过滤
            fileSelect.previousElementSibling!.textContent = 'File:';
            fileSelect.innerHTML = '<option value="all">All Files</option>';

            const consolidatedFiles = new Set(
                this.definitions
                    .filter(def => def.fileType === DefFileType.Consolidated)
                    .map(def => def.filePath)
            );

            Array.from(consolidatedFiles).sort().forEach(filePath => {
                const fileName = filePath.split('/').pop() || filePath;
                const option = fileSelect.createEl("option", {
                    value: filePath,
                    text: fileName
                });
            });
        } else if (this.selectedFileType === DefFileType.Atomic) {
            // Atomic类型 - 按文件夹过滤
            fileSelect.previousElementSibling!.textContent = 'Folder:';
            fileSelect.innerHTML = '<option value="all">All Folders</option>';

            const atomicFolders = new Set(
                this.definitions
                    .filter(def => def.fileType === DefFileType.Atomic)
                    .map(def => {
                        // 获取文件的父文件夹路径
                        const pathParts = def.filePath.split('/');
                        pathParts.pop(); // 移除文件名
                        return pathParts.join('/');
                    })
            );

            Array.from(atomicFolders).sort().forEach(folderPath => {
                const folderName = folderPath.split('/').pop() || folderPath;
                const option = fileSelect.createEl("option", {
                    value: folderPath,
                    text: folderName
                });
            });
        }

        fileSelect.value = this.selectedSourceFile;
    }

    private createStats(container: Element) {
        const stats = container.createDiv({ cls: "def-manager-stats" });
        this.updateStats(stats);
    }

    private updateStats(statsEl?: Element) {
        const stats = statsEl || this.containerEl.querySelector('.def-manager-stats');
        if (!stats) return;

        const total = this.definitions.length;
        const filtered = this.filteredDefinitions.length;
        const consolidated = this.filteredDefinitions.filter(d => d.fileType === DefFileType.Consolidated).length;
        const atomic = this.filteredDefinitions.filter(d => d.fileType === DefFileType.Atomic).length;

        stats.textContent = `Showing ${filtered} of ${total} definitions (${consolidated} consolidated, ${atomic} atomic)`;
    }

    private createDefinitionList(container: Element) {
        const listContainer = container.createDiv({ cls: "def-manager-list" });
        this.updateDefinitionList(listContainer);
    }

    	private updateDefinitionList(listContainer?: Element) {
		const list = listContainer || this.containerEl.querySelector('.def-manager-list');
		if (!list) return;

		list.empty();

		if (this.filteredDefinitions.length === 0) {
			const empty = list.createDiv({ cls: "def-manager-empty" });
			empty.innerHTML = `
				<div style="font-size: 48px; margin-bottom: 16px;">📝</div>
				<div style="font-size: 16px; margin-bottom: 8px;">No definitions found</div>
				<div style="font-size: 14px;">Try adjusting your search or filters</div>
			`;
			return;
		}

		// 只有在管理模式下才执行瀑布流布局
		if (this.currentViewMode === ViewMode.Manager) {
			// 创建所有卡片但不设置位置
			const cards: HTMLElement[] = [];
			this.filteredDefinitions.forEach(def => {
				const card = this.createDefinitionCard(list, def);
				cards.push(card);
			});

			// 等待所有卡片内容渲染完成后进行瀑布流布局
			this.waitForCardsToRender(cards).then(() => {
				this.layoutMasonry(list as HTMLElement, cards);
			});
		}

		this.updateStats();
	}

    // 等待所有卡片渲染完成
    private async waitForCardsToRender(cards: HTMLElement[]): Promise<void> {
        return new Promise((resolve) => {
            // 等待多个渲染周期确保MarkdownRenderer完成
            let checkCount = 0;
            const maxChecks = 10;

            const checkRendering = () => {
                checkCount++;

                // 检查所有卡片是否有实际高度
                const allRendered = cards.every(card => card.offsetHeight > 0);

                if (allRendered || checkCount >= maxChecks) {
                    resolve();
                } else {
                    requestAnimationFrame(checkRendering);
                }
            };

            // 开始检查
            requestAnimationFrame(checkRendering);
        });
    }

    	// 瀑布流布局核心方法
	private layoutMasonry(container: HTMLElement, cards: HTMLElement[]) {
		if (!this.isViewActive || cards.length === 0) return;

		// 计算容器宽度和列数
		const containerWidth = Math.max(200, container.clientWidth - 32); // 减去padding，确保最小宽度
		this.calculateColumns(containerWidth);

        		// 移除调试信息

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
            card.style.left = `${x}px`;
            card.style.top = `${y}px`;
            card.style.width = `${this.cardWidth}px`;
            card.style.marginBottom = '0';

            // 更新列高度
            this.columnHeights[shortestColumnIndex] += cardHeight + this.gap;
        });

        // 设置容器高度
        const maxHeight = Math.max(...this.columnHeights);
        container.style.height = `${maxHeight + 20}px`; // 额外添加一些底部间距

        // 设置ResizeObserver监听容器大小变化
        this.setupResizeObserver(container, cards);
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

    private createDefinitionCard(container: Element, def: DefinitionWithSource): HTMLElement {
        const card = container.createDiv({ cls: "def-card" });

        // 初始时设置为相对定位，等待布局完成后改为绝对定位
        card.style.position = 'relative';
        card.style.width = '100%';
        card.style.marginBottom = '16px';

        // 添加随机的视觉变化（小红书风格）
        const randomClass = Math.random() > 0.7 ? 'def-card-featured' : '';
        if (randomClass) {
            card.addClass(randomClass);
        }

        // 卡片头部
        const header = card.createDiv({ cls: "def-card-header" });
        const wordEl = header.createEl("h3", { cls: "def-card-word", text: def.word });

        // 操作按钮
        const actions = header.createDiv({ cls: "def-card-actions" });

        const editBtn = actions.createEl("button", {
            cls: "def-card-action-btn",
            text: "✏️"
        });
        editBtn.title = "Edit";
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('Edit button clicked for:', def.word);
            this.editDefinition(def);
        });

        const viewBtn = actions.createEl("button", {
            cls: "def-card-action-btn",
            text: "👁️"
        });
        viewBtn.title = "View File";
        viewBtn.addEventListener('click', () => this.openSourceFile(def));

        const deleteBtn = actions.createEl("button", {
            cls: "def-card-action-btn",
            text: "🗑️"
        });
        deleteBtn.title = "Delete";
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('Delete button clicked for:', def.word);
            this.deleteDefinition(def);
        });

        // 别名标签 - 放在原来元数据的位置
        const aliasesContainer = card.createDiv({ cls: "def-card-aliases" });
        if (def.aliases.length > 0) {
            // 最多显示3个别名，避免卡片过长
            const displayAliases = def.aliases.slice(0, 3);
            displayAliases.forEach(alias => {
                aliasesContainer.createSpan({ cls: "def-card-alias", text: alias });
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
                text: "No aliases"
            });
        }

        // 定义内容 - 使用MarkdownRenderer渲染
        const definitionEl = card.createDiv({ cls: "def-card-definition" });

        // 根据设置决定是否截断内容
        let definitionText = def.definition;
        let isTruncated = false;

        if (this.enableTruncation) {
            const maxLength = 200;
            if (definitionText.length > maxLength) {
                // 尝试在句号处截断
                const truncateAt = definitionText.lastIndexOf('。', maxLength) ||
                    definitionText.lastIndexOf('.', maxLength) ||
                    maxLength;
                definitionText = definitionText.substring(0, truncateAt) + "...";
                isTruncated = true;
            }
        }

        // 使用MarkdownRenderer渲染内容
        MarkdownRenderer.render(
            this.app,
            definitionText,
            definitionEl,
            def.sourceFile.path,
            new Component()
        );

        // 如果内容被截断，添加点击展开功能
        if (isTruncated) {
            definitionEl.style.cursor = 'pointer';
            definitionEl.title = '点击查看完整定义';
            definitionEl.addEventListener('click', () => {
                definitionEl.empty();
                MarkdownRenderer.render(
                    this.app,
                    def.definition,
                    definitionEl,
                    def.sourceFile.path,
                    new Component()
                );
                definitionEl.style.cursor = 'default';
                definitionEl.title = '';
            });
        }

        // 时间信息
        const timeInfo = card.createDiv({ cls: "def-card-time-info" });
        const createdTime = new Date(def.sourceFile.stat.ctime).toLocaleDateString();
        const modifiedTime = new Date(def.sourceFile.stat.mtime).toLocaleDateString();

        timeInfo.createSpan({
            cls: "def-card-time-item",
            text: `Created: ${createdTime}`
        });
        timeInfo.createSpan({
            cls: "def-card-time-item",
            text: `Modified: ${modifiedTime}`
        });

        return card;
    }

    	// 使用现有的EditDefinitionModal
	private async editDefinition(def: DefinitionWithSource) {
		console.log('editDefinition called for:', def.word);
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
					console.log('Definition saved, refreshing list');
					await this.loadDefinitions();
					this.updateDefinitionList();
				} else {
					console.log('No save action detected, skipping refresh');
				}
			};
			
		} catch (error) {
			console.error('Error in editDefinition:', error);
			new Notice(`Failed to open edit dialog: ${error.message}`);
		}
	}

    private async deleteDefinition(def: DefinitionWithSource) {
        const confirmModal = new Modal(this.app);
        confirmModal.setTitle("Confirm Deletion");

        const content = confirmModal.contentEl;
        content.createEl("p", { text: `Are you sure you want to delete the definition for "${def.word}"?` });
        content.createEl("p", {
            text: "This action cannot be undone.",
            cls: "mod-warning"
        });

        const buttonContainer = content.createDiv();
        buttonContainer.style.display = "flex";
        buttonContainer.style.justifyContent = "flex-end";
        buttonContainer.style.gap = "10px";
        buttonContainer.style.marginTop = "20px";

        const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
        cancelBtn.addEventListener('click', () => confirmModal.close());

        const deleteBtn = buttonContainer.createEl("button", { text: "Delete" });
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

                new Notice("Definition deleted successfully");
                confirmModal.close();

                // 刷新列表
                await this.loadDefinitions();
                this.updateDefinitionList();

            } catch (error) {
                new Notice(`Failed to delete definition: ${error.message}`);
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
        exportModal.setTitle("Export Definitions");

        const content = exportModal.contentEl;

        // 导出格式选择
        let exportFormat = 'json';
        new Setting(content)
            .setName("Export Format")
            .setDesc("Choose the format for exporting definitions")
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
            .setName("Export Scope")
            .setDesc("Choose which definitions to export")
            .addDropdown(component => {
                component.addOption('filtered', `Current Filter (${this.filteredDefinitions.length} definitions)`);
                component.addOption('all', `All Definitions (${this.definitions.length} definitions)`);
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

        const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
        cancelBtn.addEventListener('click', () => exportModal.close());

        const exportBtn = buttonContainer.createEl("button", { text: "Export" });
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
                const csvHeaders = ['Word', 'Aliases', 'Definition', 'File Type', 'Source File'];
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
                content = '# Exported Definitions\n\n';
                content += `Exported on: ${new Date().toLocaleString()}\n`;
                content += `Total definitions: ${definitions.length}\n\n`;

                definitions.forEach(def => {
                    content += `## ${def.word}\n\n`;
                    if (def.aliases.length > 0) {
                        content += `**Aliases:** ${def.aliases.join(', ')}\n\n`;
                    }
                    content += `**Definition:** ${def.definition}\n\n`;
                    content += `**Source:** ${def.sourceFile.name} (${def.fileType})\n\n`;
                    content += '---\n\n';
                });
                this.downloadFile(`definitions-${timestamp}.md`, content, 'text/markdown');
                break;
        }

        new Notice(`Exported ${definitions.length} definitions as ${format.toUpperCase()}`);
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
        batchModal.setTitle("Batch Delete Definitions");

        const content = batchModal.contentEl;

        // 警告信息
        const warning = content.createDiv({ cls: "mod-warning" });
        warning.style.padding = "15px";
        warning.style.marginBottom = "20px";
        warning.style.borderRadius = "5px";
        warning.innerHTML = `
			<strong>⚠️ Warning:</strong> This action will permanently delete the selected definitions.
			<br>For atomic definitions, the entire file will be deleted.
			<br>This action cannot be undone.
		`;

        // 删除选项
        let deleteOption = 'filtered';
        new Setting(content)
            .setName("Delete Scope")
            .setDesc("Choose which definitions to delete")
            .addDropdown(component => {
                component.addOption('filtered', `Current Filter (${this.filteredDefinitions.length} definitions)`);
                component.addOption('file', 'By Source File');
                component.addOption('type', 'By File Type');
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

        const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
        cancelBtn.addEventListener('click', () => batchModal.close());

        const deleteBtn = buttonContainer.createEl("button", { text: "Delete Selected" });
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
                    checkbox.innerHTML = `
						<input type="checkbox" value="${filePath}" style="margin-right: 8px;">
						${fileName} (${fileDefCount} definitions)
					`;
                });
                break;

            case 'type':
                const typeOptions = [
                    { value: DefFileType.Consolidated, label: 'Consolidated' },
                    { value: DefFileType.Atomic, label: 'Atomic' }
                ];

                typeOptions.forEach(type => {
                    const typeDefCount = this.definitions.filter(def => def.fileType === type.value).length;
                    if (typeDefCount > 0) {
                        const checkbox = container.createEl("label");
                        checkbox.style.display = "block";
                        checkbox.style.marginBottom = "8px";
                        checkbox.innerHTML = `
							<input type="checkbox" value="${type.value}" style="margin-right: 8px;">
							${type.label} (${typeDefCount} definitions)
						`;
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
            new Notice("No definitions selected for deletion");
            return;
        }

        // 最终确认
        const confirmModal = new Modal(this.app);
        confirmModal.setTitle("Final Confirmation");

        const content = confirmModal.contentEl;
        content.createEl("p", {
            text: `You are about to delete ${defsToDelete.length} definitions.`
        });
        content.createEl("p", {
            text: "This action cannot be undone. Are you sure?",
            cls: "mod-warning"
        });

        const buttonContainer = content.createDiv();
        buttonContainer.style.display = "flex";
        buttonContainer.style.justifyContent = "flex-end";
        buttonContainer.style.gap = "10px";
        buttonContainer.style.marginTop = "20px";

        const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
        cancelBtn.addEventListener('click', () => confirmModal.close());

        const confirmBtn = buttonContainer.createEl("button", { text: "Delete All" });
        confirmBtn.addClass("mod-warning");
        confirmBtn.addEventListener('click', async () => {
            confirmModal.close();
            await this.executeBatchDelete(defsToDelete);
        });

        confirmModal.open();
    }

    private async executeBatchDelete(definitions: DefinitionWithSource[]) {
        const notice = new Notice("Deleting definitions...", 0);
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
            new Notice(`Successfully deleted ${successCount} definitions`);
        } else {
            new Notice(`Deleted ${successCount} definitions, ${errorCount} failed`);
        }

        		// 刷新列表
		await this.loadDefinitions();
		this.updateDefinitionList();
	}



	// 渲染闪卡学习界面
	private async renderFlashcardView(container: Element) {
		// 获取主插件的闪卡管理器实例
		if (!this.flashcardManager) {
			const plugin = (this.app as any).plugins?.getPlugin('obsidian-note-definitions') as any;
			if (plugin?.flashcardManager) {
				this.flashcardManager = plugin.flashcardManager;
			} else {
				this.flashcardManager = new FlashcardManager(this.app);
			}
		}

		// 根据模式渲染不同的界面
		if (this.browseMode === 'flashcard') {
			await this.renderAtomicFlashcardStudy(container);
		} else {
			await this.renderConsolidatedBrowse(container);
		}
	}

	// 渲染atomic类型的闪卡学习
	private async renderAtomicFlashcardStudy(container: Element) {
		// 创建闪卡学习界面
		const flashcardContainer = container.createDiv({ cls: "flashcard-study-container" });
		
		// 学习统计（包含设置按钮）
		const statsContainer = flashcardContainer.createDiv({ cls: "flashcard-stats" });
		await this.updateFlashcardStats(statsContainer);

		// 卡片显示区域
		const cardContainer = flashcardContainer.createDiv({ cls: "flashcard-card-container" });
		
		// 问题区域
		const questionArea = cardContainer.createDiv({ cls: "flashcard-question" });
		
		// 答案区域（初始隐藏）
		const answerArea = cardContainer.createDiv({ cls: "flashcard-answer" });
		(answerArea as HTMLElement).style.display = "none";

		// 控制按钮区域
		const controlsContainer = flashcardContainer.createDiv({ cls: "flashcard-controls" });
		
		// 初始化学习界面
		await this.initializeFlashcardStudy(questionArea, answerArea, controlsContainer, statsContainer);
	}

	// 渲染consolidated类型的浏览模式
	private async renderConsolidatedBrowse(container: Element) {
		const browseContainer = container.createDiv({ cls: "browse-study-container" });
		
		// 获取所有consolidated文件
		const consolidatedFiles = this.flashcardManager?.getConsolidatedFiles() || [];
		
		if (consolidatedFiles.length === 0) {
			browseContainer.createEl("p", { 
				text: "No consolidated definition files found.",
				cls: "browse-empty-message"
			});
			return;
		}

		// 创建固定的卡片容器（类似Flashcard Study）
		const cardContainer = browseContainer.createDiv({ cls: "browse-card-container" });
		
		// 如果还没有选择文件，默认选择所有文件
		if (this.selectedConsolidatedFiles.length === 0) {
			this.selectedConsolidatedFiles = [...consolidatedFiles];
		}

		// 创建侧边栏布局
		const browseLayout = cardContainer.createDiv({ cls: "browse-layout" });
		
		// 左侧文件选择侧边栏
		const sidebar = browseLayout.createDiv({ cls: "browse-sidebar" });
		this.renderFileSidebar(sidebar, consolidatedFiles);
		
		// 右侧内容区域
		const contentArea = browseLayout.createDiv({ cls: "browse-content" });

		// 初始化浏览数据
		this.updateBrowseData();

		if (this.flatBrowseList.length === 0) {
			contentArea.createEl("p", { 
				text: "No definitions found in selected files.",
				cls: "browse-empty-message"
			});
			return;
		}

		// 如果还没有设置当前索引，设置为0
		if (this.currentBrowseIndex >= this.flatBrowseList.length) {
			this.currentBrowseIndex = 0;
		}

		// 渲染浏览界面
		this.renderBrowseContent(contentArea);
		
		// 在卡片容器下方添加导航按钮
		this.createBrowseNavigation(browseContainer);
	}

	// 创建浏览模式的导航按钮（放在卡片外部）
	private createBrowseNavigation(container: Element) {
		const navigationContainer = container.createDiv({ cls: "browse-navigation-external" });
		
		const prevBtn = navigationContainer.createEl("button", {
			cls: "flashcard-btn flashcard-btn-secondary",
			text: "← Previous"
		});
		prevBtn.disabled = this.currentBrowseIndex === 0;
		prevBtn.addEventListener('click', () => {
			if (this.currentBrowseIndex > 0) {
				this.currentBrowseIndex--;
				this.updateBrowseContent();
			}
		});

		const nextBtn = navigationContainer.createEl("button", {
			cls: "flashcard-btn flashcard-btn-secondary",
			text: "Next →"
		});
		nextBtn.disabled = this.currentBrowseIndex === this.flatBrowseList.length - 1;
		nextBtn.addEventListener('click', () => {
			if (this.currentBrowseIndex < this.flatBrowseList.length - 1) {
				this.currentBrowseIndex++;
				this.updateBrowseContent();
			}
		});

		const randomBtn = navigationContainer.createEl("button", {
			cls: "flashcard-btn flashcard-btn-primary",
			text: "🎲 Random"
		});
		randomBtn.addEventListener('click', () => {
			this.currentBrowseIndex = Math.floor(Math.random() * this.flatBrowseList.length);
			this.updateBrowseContent();
		});
	}

	// 更新浏览内容（不重新渲染整个界面）
	private updateBrowseContent() {
		const contentArea = this.containerEl.querySelector('.browse-content');
		if (contentArea) {
			this.renderBrowseContent(contentArea);
		}
		
		// 更新导航按钮状态
		const prevBtn = this.containerEl.querySelector('.browse-navigation-external .flashcard-btn:first-child') as HTMLButtonElement;
		const nextBtn = this.containerEl.querySelector('.browse-navigation-external .flashcard-btn:nth-child(2)') as HTMLButtonElement;
		
		if (prevBtn) prevBtn.disabled = this.currentBrowseIndex === 0;
		if (nextBtn) nextBtn.disabled = this.currentBrowseIndex === this.flatBrowseList.length - 1;
	}

	// 更新浏览数据
	private updateBrowseData() {
		this.browseDefinitions = this.flashcardManager?.getDefinitionsFromConsolidatedFiles(this.selectedConsolidatedFiles) || [];
		this.flatBrowseList = [];
		this.browseDefinitions.forEach(({ file, definitions }) => {
			definitions.forEach(definition => {
				this.flatBrowseList.push({ file, definition });
			});
		});
	}

	// 渲染文件选择侧边栏
	private renderFileSidebar(sidebar: Element, consolidatedFiles: TFile[]) {
		sidebar.innerHTML = '';
		
		const sidebarTitle = sidebar.createEl("h3", { 
			text: "Select Files",
			cls: "browse-sidebar-title"
		});
		
		// 全选/取消全选按钮
		const selectAllContainer = sidebar.createDiv({ cls: "browse-select-all" });
		const selectAllBtn = selectAllContainer.createEl("button", {
			cls: "browse-select-all-btn",
			text: this.selectedConsolidatedFiles.length === consolidatedFiles.length ? "Deselect All" : "Select All"
		});
		
		selectAllBtn.addEventListener('click', () => {
			if (this.selectedConsolidatedFiles.length === consolidatedFiles.length) {
				this.selectedConsolidatedFiles = [];
			} else {
				this.selectedConsolidatedFiles = [...consolidatedFiles];
			}
			this.updateBrowseData();
			this.currentBrowseIndex = 0;
			
			// 重新渲染侧边栏和内容
			this.renderFileSidebar(sidebar, consolidatedFiles);
			const contentArea = sidebar.parentElement?.querySelector('.browse-content');
			if (contentArea) {
				this.renderBrowseContent(contentArea);
			}
		});
		
		// 文件列表
		const fileList = sidebar.createDiv({ cls: "browse-file-list" });
		
		consolidatedFiles.forEach(file => {
			const fileItem = fileList.createDiv({ cls: "browse-file-item" });
			
			const checkbox = fileItem.createEl("input", { type: "checkbox" });
			checkbox.checked = this.selectedConsolidatedFiles.includes(file);
			
			const label = fileItem.createEl("label", { text: file.name });
			label.addEventListener('click', () => {
				checkbox.checked = !checkbox.checked;
				this.toggleFileSelection(file, checkbox.checked);
			});
			
			checkbox.addEventListener('change', (e) => {
				this.toggleFileSelection(file, (e.target as HTMLInputElement).checked);
			});
		});
	}

	// 切换文件选择状态
	private toggleFileSelection(file: TFile, selected: boolean) {
		if (selected) {
			if (!this.selectedConsolidatedFiles.includes(file)) {
				this.selectedConsolidatedFiles.push(file);
			}
		} else {
			this.selectedConsolidatedFiles = this.selectedConsolidatedFiles.filter(f => f !== file);
		}
		
		this.updateBrowseData();
		this.currentBrowseIndex = 0;
		
		// 重新渲染内容区域
		this.updateBrowseContent();
		
		// 更新全选按钮状态
		const selectAllBtn = this.containerEl.querySelector('.browse-select-all-btn') as HTMLButtonElement;
		if (selectAllBtn) {
			const consolidatedFiles = this.flashcardManager?.getConsolidatedFiles() || [];
			selectAllBtn.textContent = this.selectedConsolidatedFiles.length === consolidatedFiles.length ? "Deselect All" : "Select All";
		}
	}

	// 渲染浏览内容区域
	private renderBrowseContent(contentArea: Element) {
		contentArea.innerHTML = '';
		
		if (this.flatBrowseList.length === 0) {
			contentArea.createEl("p", { 
				text: "No definitions found in selected files.",
				cls: "browse-empty-message"
			});
			return;
		}
		
		const browseInterface = contentArea.createDiv({ cls: "browse-interface" });
		
		// 进度信息
		const progressContainer = browseInterface.createDiv({ cls: "browse-progress" });
		progressContainer.innerHTML = `
			<span class="browse-current">${this.currentBrowseIndex + 1}</span> / 
			<span class="browse-total">${this.flatBrowseList.length}</span>
		`;

		// 当前定义
		const currentItem = this.flatBrowseList[this.currentBrowseIndex];
		
		// 定义卡片
		const definitionCard = browseInterface.createDiv({ cls: "browse-definition-card" });
		
		// 词语标题
		const wordTitle = definitionCard.createEl("h2", { 
			text: currentItem.definition.word,
			cls: "browse-word-title"
		});

        // 别名
		if (currentItem.definition.aliases && currentItem.definition.aliases.length > 0) {
			const aliasesContainer = definitionCard.createDiv({ cls: "browse-aliases" });
			aliasesContainer.innerHTML = `<strong>Aliases:</strong> ${currentItem.definition.aliases.join(', ')}<br></br>`;
		}

		// 定义内容
		const definitionContent = definitionCard.createDiv({ cls: "browse-definition-content" });
		MarkdownRenderer.render(
			this.app,
			currentItem.definition.definition,
			definitionContent,
			currentItem.file.path,
			new Component()
		);

		// 文件信息
		const fileInfo = definitionCard.createDiv({ cls: "browse-file-info" });
		fileInfo.innerHTML = `From: <strong>${currentItem.file.name}</strong>`;
	}

	// 更新闪卡统计信息
	private async updateFlashcardStats(statsContainer: Element) {
		if (!this.flashcardManager) return;

		const stats = await this.flashcardManager.getStats();
		const studyQueue = await this.flashcardManager.getTodayStudyQueue();

		// 清空容器内容
		statsContainer.empty();

		// 在统计信息最左侧添加Statistics按钮
		const statisticsBtn = statsContainer.createEl("button", {
			cls: "flashcard-settings-btn-inline",
			text: "📊 Statistics"
		});
		statisticsBtn.addEventListener('click', () => {
			this.currentViewMode = ViewMode.Statistics;
			this.render();
		});

		// 创建统计信息项容器
		const statsItemsContainer = statsContainer.createDiv({ cls: "flashcard-stats-items" });
		
		statsItemsContainer.innerHTML = `
			<div class="flashcard-stats-item">
				<span class="stats-label">Today:</span>
				<span class="stats-value">${stats.todayNewCards} new, ${stats.todayReviewCards} review</span>
			</div>
			<div class="flashcard-stats-item">
				<span class="stats-label">Remaining:</span>
				<span class="stats-value">${studyQueue.length} cards</span>
			</div>
			<div class="flashcard-stats-item">
				<span class="stats-label">Total:</span>
				<span class="stats-value">${stats.totalCards} cards</span>
			</div>
			<div class="flashcard-stats-item">
				<span class="stats-label">Status:</span>
				<span class="stats-value">${stats.newCards}N ${stats.learningCards}L ${stats.reviewCards}R ${stats.graduatedCards}G</span>
			</div>
		`;

		// 在统计信息右侧添加设置按钮
		const settingsBtn = statsContainer.createEl("button", {
			cls: "flashcard-settings-btn-inline",
			text: "⚙️ Settings"
		});
		settingsBtn.addEventListener('click', () => {
			this.showFlashcardSettingsModal();
		});
	}

	// 初始化闪卡学习
	private async initializeFlashcardStudy(questionArea: Element, answerArea: Element, controlsContainer: Element, statsContainer: Element) {
		if (!this.flashcardManager) return;

		const studyQueue = await this.flashcardManager.getTodayStudyQueue();
		
		if (studyQueue.length === 0) {
			questionArea.innerHTML = `
				<h2>🎉 All done for today!</h2>
				<p>You've completed all your scheduled cards. Great job!</p>
				<p>Come back tomorrow for more learning.</p>
			`;
			
			controlsContainer.innerHTML = "";
			
			// 创建按钮容器
			const buttonContainer = controlsContainer.createDiv();
			buttonContainer.style.display = "flex";
			buttonContainer.style.justifyContent = "center";
			buttonContainer.style.gap = "15px";
			buttonContainer.style.marginTop = "20px";

			// Study Extra Cards按钮
			const studyExtraBtn = buttonContainer.createEl("button", {
				cls: "flashcard-btn flashcard-btn-primary",
				text: "📚 Study Extra Cards"
			});
			studyExtraBtn.addEventListener('click', async () => {
				await this.startExtraStudySession();
			});
			
			return;
		}

		// 开始学习会话
		this.currentStudyQueue = [...studyQueue];
		this.currentCardIndex = 0;
		this.showingAnswer = false;

		this.showCurrentCard(questionArea, answerArea, controlsContainer, statsContainer);
	}

	// 当前学习状态
	private currentStudyQueue: any[] = [];
	private currentCardIndex: number = 0;
	private showingAnswer: boolean = false;

	// 显示当前卡片
	private showCurrentCard(questionArea: Element, answerArea: Element, controlsContainer: Element, statsContainer: Element) {
		console.log('showCurrentCard 被调用, currentCardIndex:', this.currentCardIndex, 'studyQueue长度:', this.currentStudyQueue.length);
		
		if (!this.flashcardManager || this.currentCardIndex >= this.currentStudyQueue.length) {
			// 学习完成
			console.log('学习完成或无卡片，进入completeStudySession');
			this.completeStudySession(questionArea, answerArea, controlsContainer, statsContainer);
			return;
		}

		const currentCard = this.currentStudyQueue[this.currentCardIndex];
		console.log('当前卡片:', currentCard);
		
		const defManager = getDefFileManager();
		
		// 尝试通过文件路径直接获取定义
		let definition = defManager.get(currentCard.definitionKey);
		
		if (!definition) {
			console.log('通过definitionKey未找到定义，尝试通过文件路径获取');
			
			// 如果通过definitionKey找不到，尝试通过文件路径获取
			const file = this.app.vault.getAbstractFileByPath(currentCard.filePath) as TFile;
			if (file) {
				const definitions = defManager.getDefinitionsFromFile(file);
				if (definitions.length > 0) {
					definition = definitions[0]; // 使用第一个定义
					console.log('通过文件路径找到定义:', definition.word);
				}
			}
		}

		if (!definition) {
			console.log('跳过无效卡片:', currentCard.definitionKey);
			// 跳过无效卡片
			this.currentCardIndex++;
			this.showCurrentCard(questionArea, answerArea, controlsContainer, statsContainer);
			return;
		}

		// 显示问题
		let questionContent = `
			<p class="flashcard-progress">Card ${this.currentCardIndex + 1} of ${this.currentStudyQueue.length}</p>
			<h2>${definition.word}</h2>
		`;
		
		// 如果有别名，在问题阶段就显示
		if (definition.aliases && definition.aliases.length > 0) {
			questionContent += `
				<div class="flashcard-aliases-question">
					<strong>Aliases:</strong> ${definition.aliases.join(', ')}
				</div>
			`;
		}
		
		questionArea.innerHTML = questionContent;

		// 隐藏答案
		(answerArea as HTMLElement).style.display = "none";
		answerArea.innerHTML = "";
		this.showingAnswer = false;

		// 显示控制按钮
		controlsContainer.innerHTML = "";
		const showAnswerBtn = controlsContainer.createEl("button", {
			cls: "flashcard-btn flashcard-btn-primary",
			text: "Show Answer"
		});

		showAnswerBtn.addEventListener('click', () => {
			this.showAnswer(definition, answerArea, controlsContainer, statsContainer);
		});

		// 更新统计
		this.updateFlashcardStats(statsContainer);
	}

	// 显示答案
	private showAnswer(definition: any, answerArea: Element, controlsContainer: Element, statsContainer: Element) {
		this.showingAnswer = true;

		// 显示答案区域
		(answerArea as HTMLElement).style.display = "block";
		answerArea.innerHTML = "";

		// 渲染定义内容（别名已经在问题区域显示了，这里不再重复显示）
		const definitionEl = answerArea.createDiv({ cls: "flashcard-definition" });
		MarkdownRenderer.render(
			this.app,
			definition.definition,
			definitionEl,
			definition.file.path,
			new Component()
		);

		// 显示评分按钮
		controlsContainer.innerHTML = "";
		
		const buttonData = [
			{ text: "Again", cls: "flashcard-btn-danger", result: 0, desc: "Didn't know" },
			{ text: "Hard", cls: "flashcard-btn-warning", result: 1, desc: "Difficult" },
			{ text: "Good", cls: "flashcard-btn-success", result: 2, desc: "Knew it" },
			{ text: "Easy", cls: "flashcard-btn-secondary", result: 3, desc: "Too easy" }
		];

		buttonData.forEach(btn => {
			const button = controlsContainer.createEl("button", {
				cls: `flashcard-btn ${btn.cls}`,
				text: btn.text
			});
			button.title = btn.desc;
			
			button.addEventListener('click', () => {
				this.rateCard(btn.result, statsContainer);
			});
		});
	}

	// 评分卡片
	private async rateCard(result: number, statsContainer: Element) {
		if (!this.flashcardManager) return;

		const currentCard = this.currentStudyQueue[this.currentCardIndex];
		
		// 更新卡片结果
		await this.flashcardManager.updateCardResult(currentCard.filePath, result);

		// 移动到下一张卡片
		this.currentCardIndex++;
		
		// 显示下一张卡片
		setTimeout(() => {
			const questionArea = this.containerEl.querySelector('.flashcard-question') as Element;
			const answerArea = this.containerEl.querySelector('.flashcard-answer') as Element;
			const controlsContainer = this.containerEl.querySelector('.flashcard-controls') as Element;
			
			this.showCurrentCard(questionArea, answerArea, controlsContainer, statsContainer);
		}, 300);
	}

	// 完成学习会话
	private completeStudySession(questionArea: Element, answerArea: Element, controlsContainer: Element, statsContainer: Element) {
		questionArea.innerHTML = `
			<h2>🎉 Session Complete!</h2>
			<p>You've finished studying ${this.currentStudyQueue.length} cards.</p>
			<p>Great work! Keep up the consistent practice.</p>
		`;

		(answerArea as HTMLElement).style.display = "none";

		controlsContainer.innerHTML = "";
		
		// 创建按钮容器
		const buttonContainer = controlsContainer.createDiv();
		buttonContainer.style.display = "flex";
		buttonContainer.style.justifyContent = "center";
		buttonContainer.style.gap = "15px";
		buttonContainer.style.marginTop = "20px";

		// Study Extra Cards按钮
		const studyExtraBtn = buttonContainer.createEl("button", {
			cls: "flashcard-btn flashcard-btn-primary",
			text: "📚 Study Extra Cards"
		});
		studyExtraBtn.addEventListener('click', async () => {
			await this.startExtraStudySession();
		});

		// 更新最终统计
		this.updateFlashcardStats(statsContainer);
	}

	// 开始额外学习会话
	private async startExtraStudySession() {
		console.log('startExtraStudySession 被调用');
		
		if (!this.flashcardManager) {
			console.log('flashcardManager 未初始化');
			new Notice("闪卡管理器未初始化");
			return;
		}

		// 获取所有可用的卡片（不限制今日限额）
		const allCards = await this.getAllAvailableCards();
		
		console.log('获取到的卡片数量:', allCards.length);
		
		if (allCards.length === 0) {
			new Notice("暂无额外的卡片可供学习。请检查是否配置了学习范围或是否存在atomic类型的定义文件。");
			return;
		}

		// 重新开始学习会话
		this.currentStudyQueue = [...allCards];
		this.currentCardIndex = 0;
		this.showingAnswer = false;

		console.log('设置新的学习队列，卡片数量:', this.currentStudyQueue.length);
		console.log('学习队列详情:', this.currentStudyQueue);

		// 直接开始显示第一张卡片，不要重新渲染整个界面
		const questionArea = this.containerEl.querySelector('.flashcard-question') as Element;
		const answerArea = this.containerEl.querySelector('.flashcard-answer') as Element;
		const controlsContainer = this.containerEl.querySelector('.flashcard-controls') as Element;
		const statsContainer = this.containerEl.querySelector('.flashcard-stats') as Element;
		
		if (questionArea && answerArea && controlsContainer && statsContainer) {
			this.showCurrentCard(questionArea, answerArea, controlsContainer, statsContainer);
		} else {
			console.error('找不到闪卡界面元素，回退到重新渲染');
			this.render();
		}
		
		new Notice(`开始额外学习，共 ${allCards.length} 张卡片`);
	}

	// 获取所有可用的卡片（用于额外学习）
	private async getAllAvailableCards(): Promise<any[]> {
		if (!this.flashcardManager) return [];

		console.log('开始获取额外学习卡片...');

		// 直接获取所有atomic文件，绕过今日限制
		const defManager = getDefFileManager();
		const settings = getSettings();
		const flashcardConfig = settings.flashcardConfig || { studyScope: [] };
		
		const allCards: any[] = [];

		console.log('当前学习范围配置:', flashcardConfig.studyScope);

		for (const [filePath, file] of defManager.globalDefFiles) {
			const fileType = defManager.getFileType(file);
			if (fileType !== DefFileType.Atomic) continue;

			// 检查是否在学习范围内
			if (flashcardConfig.studyScope && flashcardConfig.studyScope.length > 0) {
				const folderPath = filePath.split('/').slice(0, -1).join('/') + '/';
				if (!flashcardConfig.studyScope.some(scope => scope === folderPath)) {
					continue;
				}
			}

			// 获取文件中的实际定义，使用正确的definitionKey
			const definitions = defManager.getDefinitionsFromFile(file);
			if (definitions.length > 0) {
				const definition = definitions[0]; // 使用第一个定义
				allCards.push({
					filePath: filePath,
					definitionKey: definition.key, // 使用实际的definition key
					interval: 1,
					repetitions: 0,
					easeFactor: 2.5,
					nextReviewDate: new Date()
				});
				console.log(`为文件 ${filePath} 添加卡片，definitionKey: ${definition.key}, word: ${definition.word}`);
			} else {
				console.log(`文件 ${filePath} 中没有找到定义，跳过`);
			}
		}

		console.log(`找到 ${allCards.length} 个可用的卡片`);

		// 打乱顺序以增加学习的随机性
		for (let i = allCards.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[allCards[i], allCards[j]] = [allCards[j], allCards[i]];
		}

		// 限制额外学习的卡片数量（例如最多30张）
		const result = allCards.slice(0, 30);
		console.log(`返回 ${result.length} 张卡片用于额外学习`);
		return result;
	}

	// 显示闪卡设置模态框
	private showFlashcardSettingsModal() {
		const modal = new Modal(this.app);
		modal.setTitle("Flashcard Learning Settings");

		const content = modal.contentEl;
		const settings = getSettings();
		const flashcardConfig = settings.flashcardConfig || {
			dailyNewCards: 20,
			dailyReviewLimit: 100,
			enableSM2Algorithm: true,
			studyScope: []
		};

		// 临时存储设置
		let tempConfig = { ...flashcardConfig };

		// Daily New Cards设置
		new Setting(content)
			.setName("Daily New Cards")
			.setDesc("Maximum number of new cards to study per day")
			.addSlider(component => {
				component.setLimits(5, 50, 5);
				component.setValue(tempConfig.dailyNewCards);
				component.setDynamicTooltip();
				component.onChange(value => {
					tempConfig.dailyNewCards = value;
				});
			});

		// Daily Review Limit设置
		new Setting(content)
			.setName("Daily Review Limit")
			.setDesc("Maximum number of review cards to study per day")
			.addSlider(component => {
				component.setLimits(20, 200, 10);
				component.setValue(tempConfig.dailyReviewLimit);
				component.setDynamicTooltip();
				component.onChange(value => {
					tempConfig.dailyReviewLimit = value;
				});
			});

		// SM-2 Algorithm设置
		new Setting(content)
			.setName("Enable SM-2 Algorithm")
			.setDesc("Use the SM-2 spaced repetition algorithm for optimal learning intervals")
			.addToggle(component => {
				component.setValue(tempConfig.enableSM2Algorithm);
				component.onChange(value => {
					tempConfig.enableSM2Algorithm = value;
				});
			});

		// Study Scope设置
		new Setting(content)
			.setName("Flashcard Study Scope")
			.setDesc("Select which atomic definition files or folders to include in flashcard learning")
			.addButton(component => {
				component.setButtonText("Configure");
				component.onClick(() => {
					this.showStudyScopeModal(tempConfig);
				});
			});

		// 按钮容器
		const buttonContainer = content.createDiv();
		buttonContainer.style.display = "flex";
		buttonContainer.style.justifyContent = "flex-end";
		buttonContainer.style.gap = "10px";
		buttonContainer.style.marginTop = "20px";

		const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener('click', () => modal.close());

		const saveBtn = buttonContainer.createEl("button", { text: "Save" });
		saveBtn.addClass("mod-cta");
		saveBtn.addEventListener('click', async () => {
			// 保存设置
			const currentSettings = getSettings();
			currentSettings.flashcardConfig = tempConfig;
			
			// 这里需要调用插件的保存方法
			const plugin = (this.app as any).plugins?.getPlugin('obsidian-note-definitions') as any;
			if (plugin?.saveSettings) {
				await plugin.saveSettings();
			}

			new Notice("Flashcard settings saved successfully");
			modal.close();
			
			// 重新渲染界面以反映新设置
			this.render();
		});

		modal.open();
	}

	// 显示学习范围配置模态框
	private showStudyScopeModal(tempConfig: FlashcardConfig) {
		const modal = new Modal(this.app);
		modal.setTitle("Configure Study Scope");

		const content = modal.contentEl;

		// 当前选择的范围
		const currentScope = tempConfig.studyScope || [];

		// 说明文字
		const description = content.createDiv({ cls: "study-scope-description" });
		description.innerHTML = `
			<p>Select which folders to include in flashcard learning:</p>
			<ul>
				<li><strong>Folders:</strong> Include all atomic definition files in the selected folder</li>
				<li><strong>Empty selection:</strong> Include all atomic definition files from all folders</li>
			</ul>
			<p><strong>Note:</strong> Only atomic type definitions are used for flashcard study. Consolidated files can be browsed in browse mode.</p>
		`;
		description.style.marginBottom = "20px";
		description.style.fontSize = "14px";
		description.style.color = "var(--text-muted)";

		// 创建选择列表容器
		const scopeContainer = content.createDiv({ cls: "study-scope-container" });
		scopeContainer.style.maxHeight = "400px";
		scopeContainer.style.overflowY = "auto";
		scopeContainer.style.border = "1px solid var(--background-modifier-border)";
		scopeContainer.style.borderRadius = "6px";
		scopeContainer.style.padding = "10px";
		scopeContainer.style.marginBottom = "20px";

		// 获取所有可用的文件和文件夹
		const defManager = getDefFileManager();
		const availableItems: Array<{type: 'file' | 'folder', path: string, name: string}> = [];
		const checkboxes: Array<{element: HTMLInputElement, path: string}> = [];

		// 收集所有包含atomic文件的文件夹
		const atomicFolders = new Set<string>();

		for (const [filePath, file] of defManager.globalDefFiles) {
			const fileType = defManager.getFileType(file);
			if (fileType === DefFileType.Atomic) {
				// 添加文件夹路径
				const folderPath = filePath.split('/').slice(0, -1).join('/');
				if (folderPath) {
					atomicFolders.add(folderPath + '/');
				}
			}
		}

		// 只添加文件夹选项，不显示单个文件
		Array.from(atomicFolders).sort().forEach(folderPath => {
			const folderName = folderPath.split('/').slice(-2, -1)[0] || folderPath;
			availableItems.push({
				type: 'folder',
				path: folderPath,
				name: folderName
			});
		});

		availableItems.forEach(item => {
			const itemDiv = scopeContainer.createDiv({ cls: "study-scope-item" });
			itemDiv.style.display = "flex";
			itemDiv.style.alignItems = "center";
			itemDiv.style.gap = "8px";
			itemDiv.style.padding = "6px";
			itemDiv.style.borderRadius = "4px";
			itemDiv.style.marginBottom = "4px";

			const checkbox = itemDiv.createEl("input", { type: "checkbox" });
			checkbox.checked = currentScope.includes(item.path);
			checkboxes.push({ element: checkbox, path: item.path });

			const icon = itemDiv.createSpan({ 
				text: item.type === 'folder' ? "📁" : "📄",
				cls: "study-scope-icon"
			});
			icon.style.fontSize = "14px";

			const label = itemDiv.createSpan({ 
				text: item.name,
				cls: "study-scope-label"
			});
			label.style.fontSize = "14px";
			label.style.cursor = "pointer";
			label.addEventListener('click', () => {
				checkbox.checked = !checkbox.checked;
			});

			const pathSpan = itemDiv.createSpan({ 
				text: `(${item.path})`,
				cls: "study-scope-path"
			});
			pathSpan.style.fontSize = "12px";
			pathSpan.style.color = "var(--text-muted)";
			pathSpan.style.marginLeft = "auto";

			// 悬停效果
			itemDiv.addEventListener('mouseenter', () => {
				itemDiv.style.backgroundColor = "var(--background-modifier-hover)";
			});
			itemDiv.addEventListener('mouseleave', () => {
				itemDiv.style.backgroundColor = "transparent";
			});
		});

		// 全选/取消全选按钮
		const selectAllContainer = content.createDiv();
		selectAllContainer.style.display = "flex";
		selectAllContainer.style.gap = "10px";
		selectAllContainer.style.marginBottom = "20px";

		const selectAllBtn = selectAllContainer.createEl("button", { text: "Select All" });
		selectAllBtn.style.fontSize = "12px";
		selectAllBtn.addEventListener('click', () => {
			checkboxes.forEach(cb => cb.element.checked = true);
		});

		const selectNoneBtn = selectAllContainer.createEl("button", { text: "Select None" });
		selectNoneBtn.style.fontSize = "12px";
		selectNoneBtn.addEventListener('click', () => {
			checkboxes.forEach(cb => cb.element.checked = false);
		});

		// 按钮容器
		const buttonContainer = content.createDiv();
		buttonContainer.style.display = "flex";
		buttonContainer.style.justifyContent = "flex-end";
		buttonContainer.style.gap = "10px";

		const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
		cancelButton.addEventListener('click', () => modal.close());

		const saveButton = buttonContainer.createEl("button", { text: "Save" });
		saveButton.addClass("mod-cta");
		saveButton.addEventListener('click', () => {
			const selectedPaths = checkboxes
				.filter(cb => cb.element.checked)
				.map(cb => cb.path);

			tempConfig.studyScope = selectedPaths;
			
			new Notice(`Study scope updated: ${selectedPaths.length} items selected`);
			modal.close();
		});

		modal.open();
	}

	// 渲染统计页面
	private async renderStatisticsView(container: Element) {
		if (!this.flashcardManager) {
			// 获取主插件的闪卡管理器实例
			const plugin = (this.app as any).plugins?.getPlugin('obsidian-note-definitions') as any;
			if (plugin?.flashcardManager) {
				this.flashcardManager = plugin.flashcardManager;
			} else {
				this.flashcardManager = new FlashcardManager(this.app);
			}
		}

		const statsContainer = container.createDiv({ cls: "statistics-view-container" });
		
		// 获取统计数据
		const stats = await this.flashcardManager!.getStats();
		
		// 页面标题和学习建议合并
		// const titleSection = statsContainer.createDiv({ cls: "statistics-title-section" });
		// const suggestion = await this.generateStudySuggestion(stats);
		// titleSection.innerHTML = `
		// 	<h1 class="statistics-title">📊 Learning Statistics Dashboard</h1>
		// 	<p class="statistics-subtitle">${suggestion}</p>
		// `;

		// 卡片状态分布
		const cardsSection = statsContainer.createDiv({ cls: "dashboard-section" });
		cardsSection.innerHTML = `
			<h3>📚 Card Distribution</h3>
			<div class="dashboard-stats-grid">
				<div class="dashboard-stat-card new">
					<div class="stat-number">${stats.newCards}</div>
					<div class="stat-label">New</div>
				</div>
				<div class="dashboard-stat-card learning">
					<div class="stat-number">${stats.learningCards}</div>
					<div class="stat-label">Learning</div>
				</div>
				<div class="dashboard-stat-card review">
					<div class="stat-number">${stats.reviewCards}</div>
					<div class="stat-label">Review</div>
				</div>
				<div class="dashboard-stat-card graduated">
					<div class="stat-number">${stats.graduatedCards}</div>
					<div class="stat-label">Graduated</div>
				</div>
			</div>
		`;

		// 今日学习概览
		const todaySection = statsContainer.createDiv({ cls: "dashboard-section" });
		todaySection.innerHTML = `
			<h3>📅 Today's Progress</h3>
			<div class="dashboard-stats-grid">
				<div class="dashboard-stat-card">
					<div class="stat-number">${stats.todayNewCards}</div>
					<div class="stat-label">New Cards</div>
				</div>
				<div class="dashboard-stat-card">
					<div class="stat-number">${stats.todayReviewCards}</div>
					<div class="stat-label">Reviews</div>
				</div>
				<div class="dashboard-stat-card">
					<div class="stat-number">${stats.todayNewCards + stats.todayReviewCards}</div>
					<div class="stat-label">Total Studied</div>
				</div>
			</div>
		`;

		// 创建图表双列布局区域
		const chartsSection = statsContainer.createDiv({ cls: "dashboard-section" });
		chartsSection.innerHTML = `<h3>📊 Data Visualization</h3>`;
		const chartsRow = chartsSection.createDiv({ cls: "charts-row" });
		
		// 卡片状态分布柱状图
		const cardChartContainer = chartsRow.createDiv({ cls: "chart-container" });
		cardChartContainer.innerHTML = `<h4 style="margin: 0 0 15px 0; font-size: 16px; color: var(--text-normal);">Card Status Distribution</h4>`;
		const cardCanvas = cardChartContainer.createEl("canvas", { cls: "statistics-chart" });
		await this.createCardDistributionChart(cardCanvas, stats);

		// 最近7天学习历史柱状图（放在同一行的右侧）
		const historyChartContainer = chartsRow.createDiv({ cls: "chart-container" });
		historyChartContainer.innerHTML = `<h4 style="margin: 0 0 15px 0; font-size: 16px; color: var(--text-normal);">Recent 7 Days Progress</h4>`;
		const historyCanvas = historyChartContainer.createEl("canvas", { cls: "statistics-chart" });
		await this.createWeeklyProgressChart(historyCanvas, stats);
		
		// 最近7天学习历史详细数据
		// const historySection = statsContainer.createDiv({ cls: "dashboard-section" });
		// historySection.innerHTML = `<h3>📈 Recent 7 Days Details</h3>`;
		
		// const recentSessions = stats.studySessions.slice(-7);
		// const historyGrid = historySection.createDiv({ cls: "dashboard-history-grid" });
		
		// // 确保显示最近7天，即使某些天没有学习记录
		// const today = new Date();
		// for (let i = 6; i >= 0; i--) {
		// 	const date = new Date(today);
		// 	date.setDate(date.getDate() - i);
		// 	const dateStr = date.toISOString().split('T')[0];
			
		// 	const session = recentSessions.find(s => s.date === dateStr);
		// 	const newCards = session?.newCardsStudied || 0;
		// 	const reviewCards = session?.reviewCardsStudied || 0;
		// 	const dayCard = historyGrid.createDiv({ cls: "dashboard-day-card" });
		// 	dayCard.innerHTML = `
		// 		<div class="day-date">${date.getMonth() + 1}/${date.getDate()}</div>
		// 		<div class="day-stats">
		// 			<div class="day-new">${newCards}N</div>
		// 			<div class="day-review">${reviewCards}R</div>
		// 		</div>
		// 	`;
		// }

		// 学习成就和趋势
		const achievementSection = statsContainer.createDiv({ cls: "dashboard-section" });
		achievementSection.innerHTML = `
			<h3>🏆 Learning Achievements</h3>
			<div class="dashboard-stats-grid">
				<div class="dashboard-stat-card streak">
					<div class="stat-number">${stats.currentStreak || 0}</div>
					<div class="stat-label">Current Streak</div>
				</div>
				<div class="dashboard-stat-card streak">
					<div class="stat-number">${stats.longestStreak || 0}</div>
					<div class="stat-label">Longest Streak</div>
				</div>
				<div class="dashboard-stat-card streak">
					<div class="stat-number">${stats.weeklyAverage || 0}</div>
					<div class="stat-label">Weekly Average</div>
				</div>
				<div class="dashboard-stat-card streak">
					<div class="stat-number">${Math.round((stats.averageAccuracy || 0) * 100)}%</div>
					<div class="stat-label">Accuracy</div>
				</div>
			</div>
		`;
	}

	// 创建卡片状态分布柱状图
	private async createCardDistributionChart(canvas: HTMLCanvasElement, stats: any) {
		try {
			// 动态导入Chart.js
			const Chart = await this.loadChartJS();
			
			const ctx = canvas.getContext('2d');
			if (!ctx) return;

			new Chart(ctx, {
				type: 'bar',
				data: {
					labels: ['New', 'Learning', 'Review', 'Graduated'],
					datasets: [{
						label: 'Number of Cards',
						data: [stats.newCards, stats.learningCards, stats.reviewCards, stats.graduatedCards],
						backgroundColor: [
							'rgba(59, 130, 246, 0.8)',  // Blue for New
							'rgba(245, 158, 11, 0.8)',  // Orange for Learning
							'rgba(34, 197, 94, 0.8)',   // Green for Review
							'rgba(168, 85, 247, 0.8)'   // Purple for Graduated
						],
						borderColor: [
							'rgba(59, 130, 246, 1)',
							'rgba(245, 158, 11, 1)',
							'rgba(34, 197, 94, 1)',
							'rgba(168, 85, 247, 1)'
						],
						borderWidth: 1
					}]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					plugins: {
						legend: {
							display: false
						}
					},
					scales: {
						y: {
							beginAtZero: true,
							ticks: {
								stepSize: 1
							}
						}
					}
				}
			});
		} catch (error) {
			console.error('Failed to create card distribution chart:', error);
			canvas.parentElement?.createDiv({ 
				text: 'Chart loading failed. Please check your internet connection.',
				cls: 'chart-error'
			});
		}
	}

	// 创建最近7天学习进度柱状图
	private async createWeeklyProgressChart(canvas: HTMLCanvasElement, stats: any) {
		try {
			const Chart = await this.loadChartJS();
			
			const ctx = canvas.getContext('2d');
			if (!ctx) return;

			// 准备最近7天的数据
			const today = new Date();
			const labels: string[] = [];
			const newCardsData: number[] = [];
			const reviewCardsData: number[] = [];

			for (let i = 6; i >= 0; i--) {
				const date = new Date(today);
				date.setDate(date.getDate() - i);
				const dateStr = date.toISOString().split('T')[0];
				
				labels.push(`${date.getMonth() + 1}/${date.getDate()}`);
				
				const session = stats.studySessions.find((s: any) => s.date === dateStr);
				newCardsData.push(session?.newCardsStudied || 0);
				reviewCardsData.push(session?.reviewCardsStudied || 0);
			}

			new Chart(ctx, {
				type: 'bar',
				data: {
					labels: labels,
					datasets: [
						{
							label: 'New Cards',
							data: newCardsData,
							backgroundColor: 'rgba(59, 130, 246, 0.8)',
							borderColor: 'rgba(59, 130, 246, 1)',
							borderWidth: 1
						},
						{
							label: 'Review Cards',
							data: reviewCardsData,
							backgroundColor: 'rgba(34, 197, 94, 0.8)',
							borderColor: 'rgba(34, 197, 94, 1)',
							borderWidth: 1
						}
					]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					plugins: {
						legend: {
							position: 'top'
						}
					},
					scales: {
						x: {
							stacked: true
						},
						y: {
							stacked: true,
							beginAtZero: true,
							ticks: {
								stepSize: 1
							}
						}
					}
				}
			});
		} catch (error) {
			console.error('Failed to create weekly progress chart:', error);
			canvas.parentElement?.createDiv({ 
				text: 'Chart loading failed. Please check your internet connection.',
				cls: 'chart-error'
			});
		}
	}

	// 动态加载Chart.js
	private async loadChartJS(): Promise<any> {
		// 检查是否已经加载过Chart.js
		if ((window as any).Chart) {
			return (window as any).Chart;
		}

		try {
			// 通过创建script标签的方式加载Chart.js
			return new Promise((resolve, reject) => {
				const script = document.createElement('script');
				script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js';
				script.onload = () => {
					if ((window as any).Chart) {
						resolve((window as any).Chart);
					} else {
						reject(new Error('Chart.js not found on window'));
					}
				};
				script.onerror = () => reject(new Error('Failed to load Chart.js script'));
				document.head.appendChild(script);
			});
		} catch (error) {
			console.error('Failed to load Chart.js:', error);
			throw new Error('Chart.js loading failed');
		}
	}

	// 生成学习建议
	private async generateStudySuggestion(stats: any): Promise<string> {
		// 尝试使用AI生成学习建议
		const aiSuggestion = await this.tryGenerateAISuggestion(stats);
		if (aiSuggestion) {
			return aiSuggestion;
		}
		
		// 如果AI不可用，使用默认逻辑
		const totalStudied = stats.todayNewCards + stats.todayReviewCards;
		const currentStreak = stats.currentStreak || 0;
		const accuracy = stats.averageAccuracy || 0;
		const weeklyAverage = stats.weeklyAverage || 0;
		
		// 基于多个因素生成建议
		if (totalStudied === 0) {
			if (currentStreak > 0) {
				return `🔥 Don't break your ${currentStreak}-day streak! Start with a few cards to keep the momentum going.`;
			} else {
				return "🚀 Ready to start your learning journey? Begin with some new cards!";
			}
		}
		
		if (currentStreak >= 7) {
			return `🏆 Amazing! You've maintained a ${currentStreak}-day learning streak. You're building an excellent habit!`;
		}
		
		if (accuracy < 0.6 && totalStudied > 5) {
			return "📚 Consider reviewing some cards more carefully. Quality over quantity leads to better retention!";
		}
		
		if (totalStudied < weeklyAverage * 0.7) {
			return `📈 You usually study ${weeklyAverage.toFixed(1)} cards daily. Try to reach your usual pace!`;
		}
		
		if (totalStudied >= 30) {
			return "⭐ Excellent work! You're really committed to learning. Consider taking a short break if needed.";
		}
		
		if (totalStudied >= 20) {
			return "🔥 Great progress! You're building a solid learning habit.";
		}
		
		if (totalStudied >= 10) {
			return "👍 Good momentum! Keep up the consistent practice.";
		}
		
		return "💪 You're making progress! Every card studied brings you closer to mastery.";
	}

	// 尝试使用AI生成学习建议
	private async tryGenerateAISuggestion(stats: any): Promise<string | null> {
		try {
			// 检查AI配置是否可用
			const settings = getSettings();
			const aiConfig = settings.aiConfig;
			
			if (!aiConfig || !aiConfig.currentProvider || !aiConfig.providers) {
				return null;
			}

			const currentProviderConfig = aiConfig.providers[aiConfig.currentProvider as keyof typeof aiConfig.providers];
			if (!currentProviderConfig || !currentProviderConfig.apiKey) {
				return null;
			}

			// 准备统计数据摘要
			const totalStudied = stats.todayNewCards + stats.todayReviewCards;
			const currentStreak = stats.currentStreak || 0;
			const accuracy = Math.round((stats.averageAccuracy || 0) * 100);
			const weeklyAverage = stats.weeklyAverage || 0;

			// 构建AI提示
			const prompt = `Based on the following learning statistics, generate a personalized and encouraging study suggestion (in Chinese, keep it concise, around 30-50 characters):

Statistics:
- Today studied: ${totalStudied} cards (${stats.todayNewCards} new, ${stats.todayReviewCards} review)
- Current streak: ${currentStreak} days
- Accuracy: ${accuracy}%
- Weekly average: ${weeklyAverage} cards/day
- Total cards: ${stats.totalCards}
- Card distribution: ${stats.newCards} new, ${stats.learningCards} learning, ${stats.reviewCards} review, ${stats.graduatedCards} graduated

Please provide a motivational and actionable suggestion that considers their current progress and encourages continued learning.`;

			// 使用AI服务生成建议
			const aiService = (this.app as any).plugins?.getPlugin('obsidian-note-definitions')?.aiService;
			if (!aiService) {
				return null;
			}

			const response = await aiService.generateText(prompt);
			if (response && response.trim()) {
				return response.trim();
			}

			return null;
		} catch (error) {
			console.log('AI suggestion generation failed:', error);
			return null;
		}
	}
} 