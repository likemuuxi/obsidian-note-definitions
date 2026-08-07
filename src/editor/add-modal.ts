import { App, DropdownComponent, Modal, Notice, Setting, setIcon } from "obsidian";
import { getDefFileManager, DefManager } from "src/core/def-file-manager";
import { DefFileUpdater } from "src/core/def-file-updater";
import { DefFileType } from "src/core/file-type";
import { FileParser } from "src/core/file-parser";
import { AIService } from "src/core/ai-service";
import { DEFAULT_DEFINITION_PROMPT, DEFAULT_ALIAS_PROMPT, AIConfig } from "src/settings";
import { t } from "src/i18n";

export class AddDefinitionModal {
	app: App;
	modal: Modal;
	aliases: string;
	definition: string;
	submitting: boolean;

	fileTypePicker: DropdownComponent;
	defFilePickerSetting: Setting;
	defFilePicker: DropdownComponent;

	// Consolidated类型的子文件夹选择器
	consolidatedSubfolderPickerSetting: Setting;
	consolidatedSubfolderPicker: DropdownComponent;

	atomicFolderPickerSetting: Setting;
	atomicFolderPicker: DropdownComponent;

	private aiService: AIService;

	constructor(app: App) {
		this.app = app;
		this.modal = new Modal(app);
		this.aiService = new AIService(this.getAIConfig());
	}

	private getAIConfig(): AIConfig {
		// 从插件设置中获取 AI 配置，或使用默认值
		const settings = window.NoteDefinition?.settings;
		
		const defaultConfig = {
			enabled: true,
			currentProvider: 'openai',
			customPrompt: DEFAULT_DEFINITION_PROMPT,
			customAliasPrompt: DEFAULT_ALIAS_PROMPT,
			providers: {
				openai: { apiKey: '', model: 'gpt-3.5-turbo', baseUrl: '' },
				gemini: { apiKey: '', model: 'gemini-pro', baseUrl: '' },
				ollama: { apiKey: '', model: 'llama3.2', baseUrl: 'http://localhost:11434' },
				custom: { apiKey: '', model: '', baseUrl: '' }
			},
			folderPromptMap: {},
			filePromptMap: {},
			folderAliasPromptMap: {},
			fileAliasPromptMap: {}
		};

		if (!settings?.aiConfig) {
			return defaultConfig;
		}

		// 确保enabled字段存在且为true
		const aiConfig = { ...settings.aiConfig };
		if (aiConfig.enabled === undefined || aiConfig.enabled === null) {
			aiConfig.enabled = true;
		}

		return aiConfig;
	}

	open(text?: string) {
		this.submitting = false;
		
		// 更新AI服务配置，确保获取最新的映射设置
		this.aiService.updateConfig(this.getAIConfig());
		
		this.modal.setTitle(t("Add Definition"));
		
		// 清空默认标题并创建自定义标题栏
		this.modal.titleEl.empty();
		
		const titleContainer = this.modal.titleEl.createDiv({ cls: "modal-title-with-ai" });
		titleContainer.style.display = "flex";
		titleContainer.style.alignItems = "center";
		titleContainer.style.gap = "10px";
		
		const titleText = titleContainer.createSpan({ 
			text: t("Add Definition"),
			cls: "modal-title-text"
		});
		titleText.style.fontSize = "var(--modal-title-size)";
		titleText.style.fontWeight = "var(--modal-title-weight)";
		
		const aiButton = titleContainer.createEl("button", {
			text: "✨ AI",
			cls: "ai-generate-button-inline",
			attr: {
				title: t("Generate definition and aliases with AI (prompts can be customized in settings)")
			}
		});
		
		const settingsButton = titleContainer.createEl("button", {
			text: "⚙️",
			cls: "ai-settings-button-inline",
			attr: {
				title: t("View and edit the current prompt settings")
			}
		});
		setIcon(settingsButton, "settings");
		settingsButton.style.marginLeft = "5px";
		settingsButton.style.fontSize = "14px";
		
		// 添加设置按钮点击事件
		settingsButton.addEventListener('click', () => {
			this.showPromptSettingsModal();
		});
		
		this.modal.contentEl.createDiv({
			cls: "edit-modal-section-header",
			text: t("Word/Phrase")
		})
		const phraseText = this.modal.contentEl.createEl("textarea", {
			cls: 'edit-modal-aliases',
			attr: {
				placeholder: t("Word/phrase to be defined")
			},
			text: text ?? ''
		});
		
		this.modal.contentEl.createDiv({
			cls: "edit-modal-section-header",
			text: t("Aliases")
		})
		const aliasText = this.modal.contentEl.createEl("textarea", {
			cls: 'edit-modal-aliases',
			attr: {
				placeholder: t("Add comma-separated aliases here")
			},
		});
		
		this.modal.contentEl.createDiv({
			cls: "edit-modal-section-header",
			text: t("Definition")
		});
		const defText = this.modal.contentEl.createEl("textarea", {
			cls: 'edit-modal-textarea',
			attr: {
				placeholder: t("Add definition here")
			},
		});

		// 添加AI按钮点击事件
		aiButton.addEventListener('click', async () => {
			const word = phraseText.value.trim();
			if (!word) {
				new Notice(t("Please enter a word or phrase first"));
				return;
			}
			
			const currentProvider = this.aiService.aiConfig.currentProvider || 'openai';
			const providers = this.aiService.aiConfig.providers;
			const providerConfig = providers?.[currentProvider as keyof typeof providers];
			
			if (currentProvider !== 'ollama' && !providerConfig?.apiKey) {
				new Notice(t("Please configure an API key in the plugin settings first"));
				return;
			}
			
			// 获取当前选择的文件类型和路径
			const fileType = this.fileTypePicker.getValue();
			let targetPath = '';
			
			if (fileType === 'atomic') {
				// 对于atomic类型，使用文件夹路径
				targetPath = this.atomicFolderPicker.getValue().replace(/\/$/, ''); // 移除末尾斜杠
			} else if (fileType === 'consolidated') {
				// 对于consolidated类型，使用文件路径
				targetPath = this.defFilePicker.getValue();
			}
			
			// 显示加载状态
			aiButton.setText(`🔄 ${t("Generating...")}`);
			aiButton.disabled = true;
			aiButton.style.backgroundColor = "#a0a0a0";
			
			try {
				// 调试信息：打印当前配置
				// console.log("AI配置调试信息:", {
				// 	currentProvider: this.aiService.aiConfig.currentProvider,
				// 	providers: this.aiService.aiConfig.providers,
				// 	enabled: this.aiService.aiConfig.enabled,
				// 	fileType,
				// 	targetPath
				// });
				
				// 并行生成定义和别名，传递文件类型和路径信息
				const [definition, aliases] = await Promise.all([
					this.aiService.generateDefinition(word, fileType, targetPath),
					this.aiService.generateAliases(word, fileType, targetPath)
				]);
				
				const safeDefinition = (definition || "").trim();
				const safeAliases = Array.isArray(aliases) ? aliases.filter(a => typeof a === "string" && a.trim()) : [];

				if (!safeDefinition && safeAliases.length === 0) {
					new Notice(t("AI returned neither a definition nor aliases. Please retry or check the configuration."));
					return;
				}

				// 填充定义文本框
				if (safeDefinition) {
					defText.value = safeDefinition;
				} else {
					new Notice(t("AI did not return a definition. Please enter one manually or retry."));
				}
				
				// 填充别名文本框（只有当前为空时才填充）
				if (!aliasText.value.trim()) {
					if (safeAliases.length > 0) {
						aliasText.value = safeAliases.join(', ');
					} else {
						new Notice(t("AI did not return aliases. You can add them manually."));
					}
				}

				// 聚焦到定义文本框以便用户编辑
				defText.focus();
				
			} catch (error) {
				console.error("AI生成失败详细信息:", error);
				// 显示更详细的错误信息
				const errorMessage = error instanceof Error ? error.message : String(error);
				new Notice(`❌ ${t("AI generation failed: {{error}}", { error: errorMessage })}`);
			} finally {
				// 恢复按钮状态
				aiButton.setText("✨ AI");
				aiButton.disabled = false;
				aiButton.style.backgroundColor = "";
			}
		});

		new Setting(this.modal.contentEl)
			.setName(t("Definition file type"))
			.addDropdown(component => {
				component.addOption(DefFileType.Atomic, t("Atomic"));
				component.addOption(DefFileType.Consolidated, t("Consolidated"));
				// 设置默认值为配置文件中的defaultFileType
				const settings = window.NoteDefinition.settings;
				component.setValue(settings.defFileParseConfig.defaultFileType);
				component.onChange(val => {
					if (val === DefFileType.Consolidated) {
						this.atomicFolderPickerSetting.settingEl.hide();
						this.consolidatedSubfolderPickerSetting.settingEl.show();
						this.defFilePickerSetting.settingEl.show();
					} else if (val === DefFileType.Atomic) {
						this.consolidatedSubfolderPickerSetting.settingEl.hide();
						this.defFilePickerSetting.settingEl.hide();
						this.atomicFolderPickerSetting.settingEl.show();
					}
				});
				this.fileTypePicker = component;
			});

		const defManager = getDefFileManager();
		
		// Consolidated类型的子文件夹选择器
		this.consolidatedSubfolderPickerSetting = new Setting(this.modal.contentEl)
			.setName(t("Subfolder"))
			.addDropdown(component => {
				const defFiles = defManager.getConsolidatedDefFiles();
				const defFolders = defManager.getDefFolders();
				const allSubfolders: Set<string> = new Set();
				
				// 添加主配置文件夹
				defFolders.forEach(folder => {
					allSubfolders.add(folder.path);
				});
				
				// 添加所有子文件夹路径
				defFolders.forEach(folder => {
					const files = this.app.vault.getFiles();
					files.forEach(file => {
						if (file.path.startsWith(folder.path + "/")) {
							const relativePath = file.path.substring(folder.path.length + 1);
							const pathParts = relativePath.split("/");
							
							// 如果文件在子文件夹中，添加所有层级的子文件夹路径
							if (pathParts.length > 1) {
								let currentPath = folder.path;
								for (let i = 0; i < pathParts.length - 1; i++) {
									currentPath += "/" + pathParts[i];
									allSubfolders.add(currentPath);
								}
							}
						}
					});
				});
				
				// 将所有路径排序并添加到下拉框
				const sortedPaths = Array.from(allSubfolders).sort();
				sortedPaths.forEach(folderPath => {
					component.addOption(folderPath, folderPath);
				});
				
				this.consolidatedSubfolderPicker = component;
				
				// 监听子文件夹选择变化，更新定义文件列表
				component.onChange((selectedFolder) => {
					this.refreshDefFileDropdown(selectedFolder);
				});
			});

		this.defFilePickerSetting = new Setting(this.modal.contentEl)
			.setName(t("Definition file"))
			.addDropdown(component => {
				this.defFilePicker = component;
			})
			.addButton(button => {
				button.setButtonText("+")
				.setTooltip(t("Create a new definition file"))
				.onClick(async () => {
					await this.createNewDefFile();
				});
			});
			
		// 初始化定义文件下拉框
		const defFolders = defManager.getDefFolders();
		const firstFolder = defFolders.length > 0 ? defFolders[0].path : "";
		this.refreshDefFileDropdown(firstFolder);

		this.atomicFolderPickerSetting = new Setting(this.modal.contentEl)
			.setName(t("Add file to folder"))
			.addDropdown(component => {
				const defManager = getDefFileManager();
				const defFolders = defManager.getDefFolders();
				const allFolderPaths: Set<string> = new Set();
				
				// 添加主文件夹
				defFolders.forEach(folder => {
					allFolderPaths.add(folder.path);
				});
				
				// 添加所有子文件夹路径
				defFolders.forEach(folder => {
					const files = this.app.vault.getFiles();
					files.forEach(file => {
						if (file.path.startsWith(folder.path + "/")) {
							const relativePath = file.path.substring(folder.path.length + 1);
							const pathParts = relativePath.split("/");
							
							// 如果文件在子文件夹中，添加所有层级的子文件夹路径
							if (pathParts.length > 1) {
								let currentPath = folder.path;
								for (let i = 0; i < pathParts.length - 1; i++) {
									currentPath += "/" + pathParts[i];
									allFolderPaths.add(currentPath);
								}
							}
						}
					});
				});
				
				// 将所有路径排序并添加到下拉框
				const sortedPaths = Array.from(allFolderPaths).sort();
				sortedPaths.forEach(folderPath => {
					component.addOption(folderPath, folderPath + "/");
				});
				
				this.atomicFolderPicker = component;
			})
			.addButton(button => {
				button.setButtonText("+")
				.setTooltip(t("Create a new subfolder"))
				.onClick(async () => {
					await this.createNewSubfolder();
				});
			});

		// 根据默认文件类型显示或隐藏相应的设置
		const settings = window.NoteDefinition.settings;
		if (settings.defFileParseConfig.defaultFileType === DefFileType.Consolidated) {
			this.atomicFolderPickerSetting.settingEl.hide();
			this.consolidatedSubfolderPickerSetting.settingEl.show();
			this.defFilePickerSetting.settingEl.show();
		} else {
			this.consolidatedSubfolderPickerSetting.settingEl.hide();
			this.defFilePickerSetting.settingEl.hide();
			this.atomicFolderPickerSetting.settingEl.show();
		}

		const button = this.modal.contentEl.createEl("button", {
			text: t("Save"),
			cls: 'edit-modal-save-button',
		});
		button.addEventListener('click', () => {
			if (this.submitting) {
				return;
			}
			if (!phraseText.value || !defText.value) {
				new Notice(t("Please fill in a definition value"));
				return;
			}
			
			const fileType = this.fileTypePicker.getValue();
			if (fileType === DefFileType.Consolidated && !this.defFilePicker.getValue()) {
				new Notice(t("Please choose a definition file. If you do not have any definition files, please create one."))
				return;
			} else if (fileType === DefFileType.Atomic && !this.atomicFolderPicker.getValue()) {
				new Notice(t("Please choose a folder for the atomic definition file."))
				return;
			}
			
			const defFileManager = getDefFileManager();
			const definitionFile = defFileManager.globalDefFiles.get(this.defFilePicker.getValue());
			const updated = new DefFileUpdater(this.app);
			updated.addDefinition({
				fileType: fileType as DefFileType,
				key: phraseText.value.toLowerCase(),
				word: phraseText.value,
				aliases: aliasText.value? aliasText.value.split(",").map(alias => alias.trim()) : [],
				definition: defText.value,
				file: definitionFile,
			}, this.atomicFolderPicker.getValue());
			
			this.modal.close();
		});

		this.modal.open();
	}

	private async createNewSubfolder() {
		const inputModal = new Modal(this.app);
		inputModal.setTitle(t("Create definition subcategory folders"));
		
		const inputContainer = inputModal.contentEl.createDiv();
		
		const input = inputContainer.createEl("input", {
			type: "text",
			placeholder: t("Enter folder name")
		});
		input.style.width = "100%";
		input.style.marginBottom = "10px";
		
		const buttonContainer = inputContainer.createDiv({
			cls: "modal-button-container"
		});
		buttonContainer.style.display = "flex";
		buttonContainer.style.justifyContent = "flex-end";
		buttonContainer.style.gap = "10px";
		
		const cancelButton = buttonContainer.createEl("button", { text: t("Cancel") });
		const createButton = buttonContainer.createEl("button", { text: t("Create") });
		createButton.addClass("mod-cta");
		
		return new Promise<void>((resolve) => {
			const handleCreate = async () => {
				const subfolderPath = input.value.trim();
				if (subfolderPath) {
					// 清理路径
					const cleanPath = subfolderPath.replace(/^\/+|\/+$/g, '');
					if (cleanPath) {
						// 获取当前选中的基础路径，移除末尾斜杠
						const currentSelection = this.atomicFolderPicker.getValue();
						const basePath = currentSelection.replace(/\/$/, '');
						const newFolderPath = `${basePath}/${cleanPath}`;
						
						try {
							// 直接创建文件夹，如果已存在则提示
							await this.app.vault.createFolder(newFolderPath);
							
							// 更新下拉框选项
							this.refreshFolderDropdown();
							
							// 选择新创建的文件夹
							this.atomicFolderPicker.setValue(newFolderPath + "/");
							
							new Notice(t("Subfolders have been created: {{path}}", { path: newFolderPath }));
						} catch (error: any) {
							const message = error?.message || String(error);
							// Obsidian 会在文件夹已存在时抛出异常，单独提示
							if (message.toLowerCase().includes("exists")) {
								new Notice(t("The subfolder already exists."));
							} else {
								new Notice(t("Failed to create the subfolder: {{error}}", { error: message }));
							}
						}
					}
				}
				inputModal.close();
				resolve();
			};
			
			const handleCancel = () => {
				inputModal.close();
				resolve();
			};
			
			createButton.addEventListener("click", handleCreate);
			cancelButton.addEventListener("click", handleCancel);
			
			input.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					handleCreate();
				} else if (event.key === "Escape") {
					event.preventDefault();
					handleCancel();
				}
			});
			
			inputModal.open();
			input.focus();
		});
	}
	
	private refreshFolderDropdown() {
		// 清空现有选项
		this.atomicFolderPicker.selectEl.innerHTML = "";
		
		const defManager = getDefFileManager();
		const defFolders = defManager.getDefFolders();
		const allFolderPaths: Set<string> = new Set();
		
		// 添加主文件夹
		defFolders.forEach(folder => {
			allFolderPaths.add(folder.path);
		});
		
		// 添加所有子文件夹路径
		defFolders.forEach(folder => {
			const files = this.app.vault.getFiles();
			files.forEach(file => {
				if (file.path.startsWith(folder.path + "/")) {
					const relativePath = file.path.substring(folder.path.length + 1);
					const pathParts = relativePath.split("/");
					
					// 如果文件在子文件夹中，添加所有层级的子文件夹路径
					if (pathParts.length > 1) {
						let currentPath = folder.path;
						for (let i = 0; i < pathParts.length - 1; i++) {
							currentPath += "/" + pathParts[i];
							allFolderPaths.add(currentPath);
						}
					}
				}
			});
		});
		
		// 将所有路径排序并添加到下拉框
		const sortedPaths = Array.from(allFolderPaths).sort();
		sortedPaths.forEach(folderPath => {
			this.atomicFolderPicker.addOption(folderPath, folderPath + "/");
		});
	}

	private async createNewDefFile() {
		const inputModal = new Modal(this.app);
		inputModal.setTitle(t("Create consolidated definition file"));
		
		const inputContainer = inputModal.contentEl.createDiv()
		
		const input = inputContainer.createEl("input", {
			type: "text",
			placeholder: t("Enter file name")
		});
		input.style.width = "100%";
		input.style.marginBottom = "10px";
		
		const buttonContainer = inputContainer.createDiv({
			cls: "modal-button-container"
		});
		buttonContainer.style.display = "flex";
		buttonContainer.style.justifyContent = "flex-end";
		buttonContainer.style.gap = "10px";
		
		const cancelButton = buttonContainer.createEl("button", { text: t("Cancel") });
		const createButton = buttonContainer.createEl("button", { text: t("Create") });
		createButton.addClass("mod-cta");
		
		return new Promise<void>((resolve) => {
			const handleCreate = async () => {
				const fileName = input.value.trim();
				if (fileName) {
					// 清理文件名
					const cleanFileName = fileName.replace(/\.md$/, ''); // 移除.md扩展名如果有的话
					if (cleanFileName) {
						// 获取当前选中的文件夹
						const selectedFolder = this.consolidatedSubfolderPicker.getValue();
						const filePath = `${selectedFolder}/${cleanFileName}.md`;
						
						try {
							// 创建新的定义文件
							const initialContent = "---\ndef-type: consolidated\n---\n\n";
							const newFile = await this.app.vault.create(filePath, initialContent);
							
							// 手动将新文件添加到DefManager并解析
							const defManager = getDefFileManager();
							defManager.addDefFile(newFile);
							
							// 等待metadata cache更新
							await new Promise(resolve => setTimeout(resolve, 100));
							
							// 手动解析新文件
							const parser = new FileParser(this.app, newFile);
							const definitions = await parser.parseFile();
							
							// 如果是consolidated文件，添加到consolidated文件列表
							if (parser.defFileType === DefFileType.Consolidated) {
								defManager.consolidatedDefFiles.set(newFile.path, newFile);
							}
							
							// 刷新定义文件下拉框
							await this.refreshDefFileDropdown(selectedFolder);
							
							// 选择新创建的文件
							this.defFilePicker.setValue(filePath);
							
							new Notice(t("Definition file created: {{path}}", { path: filePath }));
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
							new Notice(t("Failed to create definition file: {{error}}", { error: message }));
						}
					}
				}
				inputModal.close();
				resolve();
			};
			
			const handleCancel = () => {
				inputModal.close();
				resolve();
			};
			
			createButton.addEventListener("click", handleCreate);
			cancelButton.addEventListener("click", handleCancel);
			
			input.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					handleCreate();
				} else if (event.key === "Escape") {
					event.preventDefault();
					handleCancel();
				}
			});
			
			inputModal.open();
			input.focus();
		});
	}

	private async refreshDefFileDropdown(selectedFolder: string) {
		// 清空现有选项
		this.defFilePicker.selectEl.innerHTML = "";
		
		const defManager = getDefFileManager();
		const defFiles = defManager.getConsolidatedDefFiles();
		
		// 根据选择的文件夹过滤文件
		const filteredFiles = defFiles.filter(file => {
			const fileParentPath = file.parent?.path || "";
			
			// 如果选择的是DefFolders顶级目录，匹配该目录下的文件
			// 需要考虑文件直接在DefFolders目录下的情况
			if (fileParentPath === selectedFolder) {
				return true;
			}
			
			// 对于顶级DefFolders，还需要检查文件是否直接在该文件夹下
			// 当文件在vault根目录的DefFolders中时，parent.path可能为空
			const defFolders = defManager.getDefFolders();
			const isDefFolder = defFolders.some(folder => folder.path === selectedFolder);
			
			if (isDefFolder && fileParentPath === "") {
				// 检查文件是否真的在这个DefFolder中
				return file.path.startsWith(selectedFolder + "/") || 
				    (selectedFolder === file.path.split("/")[0]);
			}
			
			return false;
		});
		
		// 添加过滤后的文件到下拉框（getConsolidatedDefFiles已经做了def-type过滤）
		filteredFiles.forEach(file => {
			this.defFilePicker.addOption(file.path, file.name);
		});
	}

	private showPromptSettingsModal() {
		const modal = new Modal(this.app);
		modal.setTitle(t("Current prompt settings"));

		const content = modal.contentEl;

		// 获取当前选择的文件类型和路径
		const fileType = this.fileTypePicker.getValue();
		let targetPath = '';
		
		if (fileType === 'atomic') {
			targetPath = this.atomicFolderPicker.getValue().replace(/\/$/, '');
		} else if (fileType === 'consolidated') {
			targetPath = this.defFilePicker.getValue();
		}

		// 获取当前的prompt
		const currentDefinitionPrompt = this.aiService.getMappedPrompt(fileType, targetPath);
		const currentAliasPrompt = this.aiService.getMappedAliasPrompt(fileType, targetPath);

		// 检查是否使用了映射的prompt
		const aiConfig = this.aiService.aiConfig;
		let isUsingMappedDefPrompt = false;
		let isUsingMappedAliasPrompt = false;
		
		if (fileType === 'atomic') {
			isUsingMappedDefPrompt = !!(aiConfig.folderPromptMap?.[targetPath]);
			isUsingMappedAliasPrompt = !!(aiConfig.folderAliasPromptMap?.[targetPath]);
		} else if (fileType === 'consolidated') {
			isUsingMappedDefPrompt = !!(aiConfig.filePromptMap?.[targetPath]);
			isUsingMappedAliasPrompt = !!(aiConfig.fileAliasPromptMap?.[targetPath]);
		}

		// 显示当前路径信息
		const pathInfo = content.createDiv({ cls: "prompt-path-info" });
		pathInfo.style.marginBottom = "20px";
		pathInfo.style.padding = "10px";
		pathInfo.style.backgroundColor = "var(--background-secondary)";
		pathInfo.style.borderRadius = "5px";
		
		const pathTitle = pathInfo.createEl("h4", { text: t("Current selection") });
		pathTitle.style.margin = "0 0 10px 0";
		
		const fileTypeLabel = fileType === 'atomic' ? t("Atomic") : t("Consolidated");
		const typeSpan = pathInfo.createDiv({ text: t("File type: {{type}}", { type: fileTypeLabel }) });
		const pathSpan = pathInfo.createDiv({ text: t("Path: {{path}}", { path: targetPath || t("Not selected") }) });

		// 定义Prompt部分
		const defPromptSection = content.createDiv({ cls: "prompt-section" });
		defPromptSection.style.marginBottom = "20px";
		
		const defPromptTitle = defPromptSection.createEl("h4", { 
			text: t("Definition prompt {{source}}", {
				source: t(isUsingMappedDefPrompt ? "Mapped" : "Default")
			})
		});
		defPromptTitle.style.marginBottom = "10px";
		if (isUsingMappedDefPrompt) {
			defPromptTitle.style.color = "var(--interactive-accent)";
		}
		
		const defPromptTextArea = defPromptSection.createEl("textarea");
		defPromptTextArea.value = currentDefinitionPrompt;
		defPromptTextArea.style.width = "100%";
		defPromptTextArea.style.height = "120px";
		defPromptTextArea.style.resize = "vertical";
		defPromptTextArea.style.fontFamily = "monospace";
		defPromptTextArea.style.fontSize = "12px";

		// 别名Prompt部分
		const aliasPromptSection = content.createDiv({ cls: "prompt-section" });
		aliasPromptSection.style.marginBottom = "20px";
		
		const aliasPromptTitle = aliasPromptSection.createEl("h4", { 
			text: t("Alias prompt {{source}}", {
				source: t(isUsingMappedAliasPrompt ? "Mapped" : "Default")
			})
		});
		aliasPromptTitle.style.marginBottom = "10px";
		if (isUsingMappedAliasPrompt) {
			aliasPromptTitle.style.color = "var(--interactive-accent)";
		}
		
		const aliasPromptTextArea = aliasPromptSection.createEl("textarea");
		aliasPromptTextArea.value = currentAliasPrompt;
		aliasPromptTextArea.style.width = "100%";
		aliasPromptTextArea.style.height = "120px";
		aliasPromptTextArea.style.resize = "vertical";
		aliasPromptTextArea.style.fontFamily = "monospace";
		aliasPromptTextArea.style.fontSize = "12px";

		// 按钮容器
		const buttonContainer = content.createDiv();
		buttonContainer.style.display = "flex";
		buttonContainer.style.justifyContent = "space-between";
		buttonContainer.style.gap = "10px";
		buttonContainer.style.marginTop = "20px";

		// 左侧按钮组
		const leftButtons = buttonContainer.createDiv();
		leftButtons.style.display = "flex";
		leftButtons.style.gap = "10px";

		const resetButton = leftButtons.createEl("button", { text: t("Reset to default") });
		resetButton.onclick = () => {
			defPromptTextArea.value = this.aiService.aiConfig.customPrompt || '';
			aliasPromptTextArea.value = this.aiService.aiConfig.customAliasPrompt || '';
		};

		const manageButton = leftButtons.createEl("button", { text: t("Manage mappings") });
		manageButton.onclick = () => {
			modal.close();
			// 打开插件设置页面的映射管理
			// @ts-ignore
			this.app.setting.open();
			// @ts-ignore
			this.app.setting.openTabById('obsidian-note-definitions');
		};

		// 右侧按钮组
		const rightButtons = buttonContainer.createDiv();
		rightButtons.style.display = "flex";
		rightButtons.style.gap = "10px";

		const cancelButton = rightButtons.createEl("button", { text: t("Cancel") });
		cancelButton.onclick = () => modal.close();

		const saveButton = rightButtons.createEl("button", { text: t("Save mapping") });
		saveButton.addClass("mod-cta");
		saveButton.onclick = async () => {
			if (!targetPath) {
				new Notice(t("Please select a folder or file first"));
				return;
			}

			// 更新AI服务配置
			const newConfig = { ...this.aiService.aiConfig };
			
			if (fileType === 'atomic') {
				if (!newConfig.folderPromptMap) newConfig.folderPromptMap = {};
				if (!newConfig.folderAliasPromptMap) newConfig.folderAliasPromptMap = {};
				newConfig.folderPromptMap[targetPath] = defPromptTextArea.value;
				newConfig.folderAliasPromptMap[targetPath] = aliasPromptTextArea.value;
			} else {
				if (!newConfig.filePromptMap) newConfig.filePromptMap = {};
				if (!newConfig.fileAliasPromptMap) newConfig.fileAliasPromptMap = {};
				newConfig.filePromptMap[targetPath] = defPromptTextArea.value;
				newConfig.fileAliasPromptMap[targetPath] = aliasPromptTextArea.value;
			}

			this.aiService.updateConfig(newConfig);

			// 保存到插件设置
			const settings = window.NoteDefinition.settings;
			if (!settings.aiConfig) {
				settings.aiConfig = newConfig;
			} else {
				settings.aiConfig.folderPromptMap = newConfig.folderPromptMap;
				settings.aiConfig.filePromptMap = newConfig.filePromptMap;
				settings.aiConfig.folderAliasPromptMap = newConfig.folderAliasPromptMap;
				settings.aiConfig.fileAliasPromptMap = newConfig.fileAliasPromptMap;
			}

			// 触发设置保存 - 简化版本，直接更新设置
			new Notice(`✅ ${t("Prompt mapping saved")}`);
			modal.close();
		};

		modal.open();
	}
}
