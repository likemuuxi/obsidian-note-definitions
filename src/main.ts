import { Menu, Notice, Plugin, TFolder, WorkspaceWindow, TFile, MarkdownView, WorkspaceLeaf } from 'obsidian';
import { injectGlobals } from './globals';
import { logDebug } from './util/log';
import { definitionMarker } from './editor/decoration';
import { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { DefManager, initDefFileManager } from './core/def-file-manager';
import { DefinitionManagerView, DEFINITION_MANAGER_VIEW_TYPE } from './views/definition-manager-view';
import { DefinitionSidebarView, DEFINITION_SIDEBAR_VIEW_TYPE } from './views/definition-sidebar-view';
import { Definition } from './core/model';
import { getDefinitionPopover, initDefinitionPopover } from './editor/definition-popover';
import { postProcessor } from './editor/md-postprocessor';
import { getSettings, normalizeSettings, SettingsTab } from './settings';
import { getMarkedWordUnderCursor } from './util/editor';
import { FileExplorerDecoration, initFileExplorerDecoration } from './core/file-explorer';
import { EditDefinitionModal } from './editor/edit-modal';
import { AddDefinitionModal } from './editor/add-modal';
import { initDefinitionModal } from './editor/mobile/definition-modal';
import { FMSuggestModal } from './editor/frontmatter-suggest-modal';
import { registerDefFile } from './editor/def-file-registration';
import { DefFileType } from './core/file-type';
import { DefFileUpdater, DEFINITIONS_UPDATED_EVENT } from './core/def-file-updater';
import { Modal } from 'obsidian';
import { t } from './i18n';


export default class NoteDefinition extends Plugin {
	activeEditorExtensions: Extension[] = [];
	defManager: DefManager;
	fileExplorerDeco: FileExplorerDecoration;

	async onload() {
		// Settings are injected into global object
		const data = await this.loadData();
		const settings = normalizeSettings(data);
		injectGlobals(settings, this.app, window);

		this.registerEvent(this.app.workspace.on('window-open', (win: WorkspaceWindow, newWindow: Window) => {
			injectGlobals(settings, this.app, newWindow);
		}))

		logDebug("Load note definition plugin");

		// 注册定义管理器视图
		this.registerView(
			DEFINITION_MANAGER_VIEW_TYPE,
			(leaf) => new DefinitionManagerView(leaf)
		);
		this.registerView(
			DEFINITION_SIDEBAR_VIEW_TYPE,
			(leaf) => new DefinitionSidebarView(leaf)
		);

		// 添加侧边栏图标
		this.addRibbonIcon('swatch-book', t('Definition Manager'), () => {
			this.activateDefinitionManagerView();
		});

		initDefinitionPopover(this);
		initDefinitionModal(this.app);
		this.defManager = initDefFileManager(this.app);
		this.fileExplorerDeco = initFileExplorerDecoration(this.app);
		this.registerEditorExtension(this.activeEditorExtensions);
		this.updateEditorExts();

		this.registerCommands();
		this.registerEvents();

		this.addSettingTab(new SettingsTab(this.app, this, this.saveSettings.bind(this)));
		this.registerMarkdownPostProcessor(postProcessor);

		this.fileExplorerDeco.run();

		// 在依赖初始化完成后再激活侧边栏，避免空内容
		// this.activateDefinitionSidebarView();
	}

	async saveSettings() {
		await this.saveData(window.NoteDefinition.settings);
		this.fileExplorerDeco.run();
		this.refreshDefinitions();
	}

	registerCommands() {
		this.addCommand({
			id: "preview-definition",
			name: t("Preview definition"),
			editorCallback: (editor) => {
				const curWord = getMarkedWordUnderCursor(editor);
				if (!curWord) return;
				const def = window.NoteDefinition.definitions.global.get(curWord);
				if (!def) return;
				getDefinitionPopover().openAtCursor(def);
			}
		});

		this.addCommand({
			id: "goto-definition",
			name: t("Go to definition"),
			editorCallback: (editor) => {
				const currWord = getMarkedWordUnderCursor(editor);
				if (!currWord) return;
				const def = this.defManager.get(currWord);
				if (!def) return;
				this.app.workspace.openLinkText(def.linkText, '');
			}
		});

		this.addCommand({
			id: "add-definition",
			name: t("Add definition"),
			editorCallback: (editor) => {
			const selectedText = editor.getSelection();
			// 提取光标所在段落作为上下文
			const cursor = editor.getCursor('from');
			let context = '';
			if (cursor) {
				const line = cursor.line;
				// 向上找段落起点（空行或文档顶部）
				let startLine = line;
				while (startLine > 0 && editor.getLine(startLine - 1).trim() !== '') {
					startLine--;
				}
				// 向下找段落终点（空行或文档底部）
				let endLine = line;
				const lastLine = editor.lastLine();
				while (endLine < lastLine && editor.getLine(endLine + 1).trim() !== '') {
					endLine++;
				}
				// 提取段落文本
				const lines: string[] = [];
				for (let i = startLine; i <= endLine; i++) {
					lines.push(editor.getLine(i));
				}
				context = lines.join('\n');
			}
			const addModal = new AddDefinitionModal(this.app, this.saveSettings.bind(this));
			addModal.open(selectedText, context);
		}
		});

		this.addCommand({
			id: "add-def-context",
			name: t("Add definition context"),
			editorCallback: (editor) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) {
					new Notice(t("Command must be used within an active opened file"));
					return;
				}
				const suggestModal = new FMSuggestModal(this.app, activeFile);
				suggestModal.open();
			}
		});

		this.addCommand({
			id: "refresh-definitions",
			name: t("Refresh definitions"),
			callback: async () => {
				this.fileExplorerDeco.run();
				await this.defManager.loadDefinitions();
				this.updateEditorExts();
				this.defManager.updateActiveFile();
				this.refreshOpenDefinitionViews();
				this.refreshEditorDecorations();
			}
		});

		this.addCommand({
			id: "register-consolidated-def-file",
			name: t("Register consolidated definition file"),
			editorCallback: (_) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) {
					new Notice(t("Command must be used within an active opened file"));
					return;
				}
				registerDefFile(this.app, activeFile, DefFileType.Consolidated);
			}
		});

		this.addCommand({
			id: "register-atomic-def-file",
			name: t("Register atomic definition file"),
			editorCallback: (_) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) {
					new Notice(t("Command must be used within an active opened file"));
					return;
				}
				registerDefFile(this.app, activeFile, DefFileType.Atomic);
			}
		});

		this.addCommand({
			id: "open-definition-manager",
			name: t("Open Definition Manager"),
			callback: () => {
				this.activateDefinitionManagerView();
			}
		});

		this.addCommand({
			id: "open-definition-sidebar",
			name: t("Open Definition Sidebar"),
			callback: () => {
				this.activateDefinitionSidebarView();
			}
		});
	}

	registerEvents() {
		this.registerEvent(this.app.workspace.on("active-leaf-change", async (leaf) => {
			if (!leaf) return;
			this.reloadUpdatedDefinitions();
			this.updateEditorExts();
			this.defManager.updateActiveFile();
			this.refreshEditorDecorations();
		}));

		this.registerEvent(this.app.workspace.on(DEFINITIONS_UPDATED_EVENT as any, async () => {
			this.reloadUpdatedDefinitions();
			this.refreshOpenDefinitionViews();
			this.refreshEditorDecorations();
		}));

		this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor) => {
			const defPopover = getDefinitionPopover();
			if (defPopover) {
				defPopover.close();
			}

			const curWord = getMarkedWordUnderCursor(editor);
			if (!curWord) {
				if (editor.getSelection()) {
					menu.addItem(item => {
						item.setTitle(t("Add definition"))
						item.setIcon("plus")
							.onClick(() => {
							const sel = editor.getSelection();
							// 提取光标所在段落作为上下文
							const cursor = editor.getCursor('from');
							let context = '';
							if (cursor) {
								const line = cursor.line;
								let startLine = line;
								while (startLine > 0 && editor.getLine(startLine - 1).trim() !== '') {
									startLine--;
								}
								let endLine = line;
								const lastLine = editor.lastLine();
								while (endLine < lastLine && editor.getLine(endLine + 1).trim() !== '') {
									endLine++;
								}
								const lines: string[] = [];
								for (let i = startLine; i <= endLine; i++) {
									lines.push(editor.getLine(i));
								}
								context = lines.join('\n');
							}
							const addModal = new AddDefinitionModal(this.app, this.saveSettings.bind(this));
							addModal.open(sel, context);
						});
					});
				}
				return;
			};
			const def = this.defManager.get(curWord);
			if (!def) {
				return;
			};
			this.registerMenuForMarkedWords(menu, def);
		}));

		// Add file menu options
		this.registerEvent(this.app.workspace.on("file-menu", (menu, file, source) => {
			if (file instanceof TFolder) {
				menu.addItem(item => {
					item.setTitle(t("Set definition folder"))
						.setIcon("book-a")
						.onClick(() => {
							const settings = getSettings();
							settings.defFolder = file.path;
							this.saveSettings();
						});
				});
			}
		}));

		// Creating files under def folder should register file as definition file
		this.registerEvent(this.app.vault.on('create', (file) => {
			const settings = getSettings();
			if (file.path.startsWith(settings.defFolder)) {
				this.fileExplorerDeco.run();
				this.refreshDefinitions();
			}
		}));

		this.registerEvent(this.app.metadataCache.on('changed', (file: TFile) => {
			const currFile = this.app.workspace.getActiveFile();

			if (currFile && currFile.path === file.path) {
				this.defManager.updateActiveFile();

				let activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

				if (activeView) {
					// @ts-expect-error, not typed
					const view = activeView.editor.cm as EditorView;
					const plugin = view.plugin(definitionMarker);

					if (plugin) {
						plugin.forceUpdate();
					}
				}
			}
		}));
	}

	registerMenuForMarkedWords(menu: Menu, def: Definition) {
		menu.addItem((item) => {
			item.setTitle(t("Go to definition"))
				.setIcon("arrow-left-from-line")
				.onClick(() => {
					this.app.workspace.openLinkText(def.linkText, '');
				});
		})

		menu.addItem(item => {
			item.setTitle(t("Edit definition"))
				.setIcon("pencil")
				.onClick(() => {
					const editModal = new EditDefinitionModal(this.app);
					editModal.open(def);
				});
		});

		menu.addItem(item => {
			item.setTitle(t("Delete definition"))
				.setIcon("trash")
				.onClick(async () => {
					// 显示确认对话框
					const confirmed = await this.showDeleteConfirmation(def);
					if (confirmed) {
						const updater = new DefFileUpdater(this.app);
						await updater.deleteDefinition(def);
					}
				});
		});
	}

	async refreshDefinitions() {
		await this.defManager.loadDefinitions();
	}

	reloadUpdatedDefinitions() {
		this.defManager.loadUpdatedFiles();
	}

	updateEditorExts() {
		const currFile = this.app.workspace.getActiveFile();
		if (currFile && this.defManager.isDefFile(currFile)) {
			// TODO: Editor extension for definition file
			this.setActiveEditorExtensions([]);
		} else {
			this.setActiveEditorExtensions(definitionMarker);
		}
	}

	private setActiveEditorExtensions(...ext: Extension[]) {
		this.activeEditorExtensions.length = 0;
		this.activeEditorExtensions.push(...ext);
		this.app.workspace.updateOptions();
	}

	private refreshEditorDecorations() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView) {
			// @ts-expect-error not typed
			const view = activeView.editor.cm as EditorView;
			const plugin = view.plugin(definitionMarker);
			if (plugin?.forceUpdate) {
				plugin.forceUpdate();
			}

			if (activeView.previewMode) {
				activeView.previewMode.rerender(true);
			}
		}
	}

	private async refreshOpenDefinitionViews() {
		// Refresh sidebar views
		const sidebarLeaves = this.app.workspace.getLeavesOfType(DEFINITION_SIDEBAR_VIEW_TYPE);
		for (const leaf of sidebarLeaves) {
			const view = leaf.view as any;
			if (view?.loadDefinitions && view?.render) {
				await view.loadDefinitions();
				view.render();
			}
		}

		// Refresh manager views
		const managerLeaves = this.app.workspace.getLeavesOfType(DEFINITION_MANAGER_VIEW_TYPE);
		for (const leaf of managerLeaves) {
			const view = leaf.view as any;
			if (view?.loadDefinitions && view?.render) {
				await view.loadDefinitions();
				view.render();
			}
		}
	}

	async activateDefinitionManagerView() {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(DEFINITION_MANAGER_VIEW_TYPE)[0] as WorkspaceLeaf | null;;

		if (!leaf) {
			leaf = workspace.getLeaf(true);
			if (!leaf) {
				return;
			}
			await leaf.setViewState({
				type: DEFINITION_MANAGER_VIEW_TYPE,
				active: true,
			});
		}

		// 激活视图
		workspace.revealLeaf(leaf);
	}

	async activateDefinitionSidebarView() {
		const { workspace } = this.app;

		// Ensure workspace layout exists before requesting side leaf
		if (!workspace.layoutReady) {
			await new Promise<void>((resolve) => workspace.onLayoutReady(resolve));
		}
		const existingLeaf = workspace.getLeavesOfType(DEFINITION_SIDEBAR_VIEW_TYPE)[0] as WorkspaceLeaf | null;
		if (existingLeaf) {
			workspace.revealLeaf(existingLeaf);
			return;
		}

		const leaf = workspace.getRightLeaf(false);
		if (!leaf) {
			return;
		}

		await leaf.setViewState({
			type: DEFINITION_SIDEBAR_VIEW_TYPE,
			active: true,
		});

		workspace.revealLeaf(leaf);
	}

	onunload() {
		logDebug("Unload note definition plugin");
		getDefinitionPopover().cleanUp();
	}

	private async showDeleteConfirmation(def: Definition): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = new Modal(this.app);
			modal.setTitle(t("Confirm deletion"));

			const content = modal.contentEl;

			if (def.fileType === DefFileType.Atomic) {
				content.createEl("p", {
					text: t("This will delete the entire file."),
					cls: "mod-warning"
				});
			} else {
				content.createEl("p", {
					text: t("This will remove this definition from the consolidated file.")
				});
			}

			const buttonContainer = content.createDiv({
				cls: "modal-button-container"
			});
			buttonContainer.style.display = "flex";
			buttonContainer.style.justifyContent = "flex-end";
			buttonContainer.style.gap = "10px";
			buttonContainer.style.marginTop = "20px";

			const cancelButton = buttonContainer.createEl("button", { text: t("Cancel") });
			const deleteButton = buttonContainer.createEl("button", {
				text: t("Delete"),
				cls: "mod-warning"
			});

			cancelButton.addEventListener("click", () => {
				modal.close();
				resolve(false);
			});

			deleteButton.addEventListener("click", () => {
				modal.close();
				resolve(true);
			});

			modal.open();
		});
	}
}
