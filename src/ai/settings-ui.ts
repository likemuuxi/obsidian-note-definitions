import { App, Modal, Notice, Setting, TextComponent, requestUrl } from "obsidian";
import { t } from "../i18n";
import {
	AIConfig, ProviderEntry,
	DEFAULT_DEFINITION_PROMPT, DEFAULT_ALIAS_PROMPT,
	DEFINITION_PROMPT_TEMPLATES, ALIAS_PROMPT_TEMPLATES,
} from "./types";
import {
	APIProtocol, PROTOCOL_TYPES, PROTOCOLS,
	getProtocol, protocolLabel, isTestResponseValid
} from "./providers";
import { SecretSelectionModal } from "./secret-selection-modal";

/** Context passed from the host SettingsTab so this renderer can mutate settings and re-render. */
export interface AISettingsContext {
	app: App;
	getAIConfig(): AIConfig;
	saveCallback(): Promise<void>;
	rerender(): void;
}

export class AISettingsRenderer {
	constructor(private ctx: AISettingsContext) {}

	render(containerEl: HTMLElement): void {
		this.ensureAIConfig();
		const ai = this.ctx.getAIConfig();

		new Setting(containerEl)
			.setHeading()
			.setName(t("AI integration settings"));

		new Setting(containerEl)
			.setName(t("Add provider"))
			.setDesc(t("Configure a new AI provider"))
			.addButton(component => {
				component.setButtonText(t("Add"));
				component.onClick(() => {
					this.showProviderModal('add');
				});
			});

		this.renderProviderList(containerEl);

		// 添加Prompt映射设置
		new Setting(containerEl)
			.setHeading()
			.setName(t("Prompt settings"));

		new Setting(containerEl)
			.setName(t("Default prompts"))
			.setDesc(t("Configure default prompts for definition and alias generation"))
			.addButton(component => {
				component.setButtonText(t("Manage"));
				component.onClick(() => {
					this.showPromptEditModal('default',
						this.ctx.getAIConfig().customPrompt || DEFAULT_DEFINITION_PROMPT,
						this.ctx.getAIConfig().customAliasPrompt || DEFAULT_ALIAS_PROMPT,
						async (newPrompt, newAliasPrompt) => {
							this.ensureAIConfig();
							this.ctx.getAIConfig().customPrompt = newPrompt;
							this.ctx.getAIConfig().customAliasPrompt = newAliasPrompt;
							await this.ctx.saveCallback();
						}
					);
				});
			});

		new Setting(containerEl)
			.setName(t("Folder prompt mapping (atomic)"))
			.setDesc(t("Set specific prompts for different folders when creating atomic definitions"))
			.addButton(component => {
				component.setButtonText(t("Manage"));
				component.onClick(() => {
					this.showPromptMappingModal('folder');
				});
			});

		new Setting(containerEl)
			.setName(t("File prompt mapping (consolidated)"))
			.setDesc(t("Set specific prompts for different consolidated definition files"))
			.addButton(component => {
				component.setButtonText(t("Manage"));
				component.onClick(() => {
					this.showPromptMappingModal('file');
				});
			});
	}

	private ensureAIConfig(): void {
		const ai = this.ctx.getAIConfig();
		if (!Array.isArray(ai.providers)) {
			ai.providers = [];
		}
	}

	private renderProviderList(container: HTMLElement): void {
		const ai = this.ctx.getAIConfig();

		if (ai.providers.length === 0) {
			new Setting(container)
				.setName(t("No providers configured"));
			return;
		}

		ai.providers.forEach(entry => {
			const isActive = entry.id === ai.activeProviderId;
			const metaParts = [protocolLabel(entry.protocol)];
			if (entry.baseUrl) metaParts.push(entry.baseUrl);
			if (isActive) metaParts.push(t("Active"));

			const setting = new Setting(container)
				.setName(`${entry.name} · ${entry.model}`)
				.setDesc(metaParts.join(' · '));

			if (!isActive) {
				setting.addExtraButton(btn => {
					btn.setIcon('circle');
					btn.setTooltip(t("Set as active"));
					btn.onClick(async () => {
						ai.activeProviderId = entry.id;
						await this.ctx.saveCallback();
						this.ctx.rerender();
					});
				});
			} else {
				setting.addExtraButton(btn => {
					btn.setIcon('check-circle');
					btn.setTooltip(t("Active"));
					btn.setDisabled(true);
				});
			}

			setting.addButton(btn => {
				btn.setButtonText(t("Edit"));
				btn.onClick(() => this.showProviderModal('edit', entry));
			});

			setting.addButton(btn => {
				btn.setButtonText(t("Delete"));
				btn.onClick(async () => {
					await this.deleteProvider(entry);
				});
			});
		});
	}

	private async deleteProvider(entry: ProviderEntry): Promise<void> {
		const ai = this.ctx.getAIConfig();
		const idx = ai.providers.findIndex(p => p.id === entry.id);
		if (idx < 0) return;
		ai.providers.splice(idx, 1);

		// 密钥保留在 SecretStorage 中，不自动删除（用户可能复用于其他供应商）

		if (ai.activeProviderId === entry.id) {
			ai.activeProviderId = ai.providers[0]?.id;
		}
		await this.ctx.saveCallback();
		this.ctx.rerender();
	}

	private showProviderModal(mode: 'add' | 'edit', existing?: ProviderEntry): void {
		this.ensureAIConfig();
		const modal = new Modal(this.ctx.app);
		modal.setTitle(mode === 'add' ? t("Add provider") : t("Edit provider"));
		const content = modal.contentEl;

		const entry: ProviderEntry = existing
			? { ...existing }
			: { id: '', protocol: 'openai-compatible', name: '', model: '' };

		let currentProtocol: APIProtocol = entry.protocol;
		let selectedSecretKey: string | undefined = entry.secretKey;

		// Protocol
		new Setting(content)
			.setName(t("API protocol"))
			.setDesc(t("Choose your AI API protocol"))
			.addDropdown(dd => {
				PROTOCOL_TYPES.forEach(ty => dd.addOption(ty, protocolLabel(ty)));
				dd.setValue(currentProtocol);
				dd.onChange(v => {
					currentProtocol = v as APIProtocol;
					// 更新默认 baseUrl
					const meta = PROTOCOLS[currentProtocol];
					if (urlInput) urlInput.setValue(meta.defaultBaseUrl);
					updateDynamic();
				});
			});

		// Provider name
		let nameInput: TextComponent;
		new Setting(content)
			.setName(t("Provider name"))
			.setDesc(t("Display name for this provider"))
			.addText(t1 => {
				nameInput = t1;
				t1.setValue(entry.name);
			});

		// Model
		let modelInput: TextComponent;
		const modelSetting = new Setting(content)
			.setName(t("AI model"))
			.setDesc(t("Choose the AI model to use for definition generation"))
			.addText(t2 => {
				modelInput = t2;
				t2.setValue(entry.model);
			});

		// Base URL
		let urlInput: TextComponent;
		const urlSetting = new Setting(content)
			.setName(t("Base URL"));
		urlSetting.addText(t3 => {
			urlInput = t3;
			t3.setPlaceholder("https://api.openai.com/v1/chat/completions");
			const meta = PROTOCOLS[currentProtocol];
			t3.setValue(entry.baseUrl || meta.defaultBaseUrl);
		});

		// API key — 通过密钥选择模态框管理
		const keySetting = new Setting(content).setName(t("API key"));
		const updateKeyDesc = () => {
			const displayKey = selectedSecretKey
				? (selectedSecretKey.startsWith('def-') ? selectedSecretKey.slice(4) : selectedSecretKey)
				: '';
			keySetting.setDesc(displayKey ? `✓ ${displayKey}` : t("No secret selected"));
		};
		keySetting.addButton(btn => {
			btn.setButtonText(selectedSecretKey ? t("Change") : t("Select"));
			btn.onClick(() => {
				new SecretSelectionModal(this.ctx.app, selectedSecretKey ?? null, (key) => {
					selectedSecretKey = key;
					btn.setButtonText(t("Change"));
					updateKeyDesc();
				}).open();
			});
		});
		updateKeyDesc();

		const updateDynamic = () => {
			const meta = PROTOCOLS[currentProtocol];
			modelInput.setPlaceholder(meta.modelsPlaceholder);
			urlSetting.settingEl.style.display = meta.needsBaseUrl ? '' : 'none';
			keySetting.settingEl.style.display = meta.needsApiKey ? '' : 'none';
		};
		updateDynamic();

		// buttons
		const btnRow = content.createDiv();
		btnRow.style.display = "flex";
		btnRow.style.justifyContent = "space-between";
		btnRow.style.gap = "10px";
		btnRow.style.marginTop = "12px";

		// Test button (left side)
		const testBtn = btnRow.createEl("button", { text: t("Test") });
		testBtn.onclick = async () => {
			const testModel = modelInput.getValue().trim();
			const meta = PROTOCOLS[currentProtocol];
			const testUrl = meta.needsBaseUrl ? urlInput.getValue().trim() : undefined;

			// 从选中的密钥获取值
			let testKey = '';
			if (meta.needsApiKey && selectedSecretKey) {
				testKey = this.ctx.app.secretStorage.getSecret(selectedSecretKey) ?? '';
			}
			await this.testConnectionWithParams(currentProtocol, testModel, testUrl, testKey);
		};

		// Right-side buttons
		const rightBtns = btnRow.createDiv();
		rightBtns.style.display = "flex";
		rightBtns.style.gap = "10px";

		const cancelBtn = rightBtns.createEl("button", { text: t("Cancel") });
		cancelBtn.onclick = () => modal.close();

		const saveBtn = rightBtns.createEl("button", { text: t("Save") });
		saveBtn.addClass("mod-cta");
		saveBtn.onclick = async () => {
			const newName = nameInput.getValue().trim();
			const newModel = modelInput.getValue().trim();
			if (!newName) { new Notice(t("Please enter a provider name")); return; }
			if (!newModel) { new Notice(t("Please enter a model name")); return; }

			const meta = PROTOCOLS[currentProtocol];
			entry.name = newName;
			entry.model = newModel;
			entry.protocol = currentProtocol;
			entry.baseUrl = meta.needsBaseUrl ? (urlInput.getValue().trim() || undefined) : undefined;
			entry.secretKey = meta.needsApiKey ? selectedSecretKey : undefined;

			const ai = this.ctx.getAIConfig();

			if (mode === 'add') {
				entry.id = `${currentProtocol}-${Date.now()}`;
				ai.providers.push(entry);
				if (!ai.activeProviderId) ai.activeProviderId = entry.id;
			} else {
				const idx = ai.providers.findIndex(p => p.id === entry.id);
				if (idx >= 0) ai.providers[idx] = entry;
			}

			await this.ctx.saveCallback();
			modal.close();
			this.ctx.rerender();
		};

		modal.open();
	}

	private async testConnectionWithParams(
		protocol: APIProtocol,
		model: string,
		baseUrl: string | undefined,
		apiKey: string
	): Promise<void> {
		const adapter = getProtocol(protocol);
		if (!adapter || !model) {
			new Notice(t("Please configure an AI provider and model first"));
			return;
		}

		if (adapter.needsApiKey && !apiKey) {
			new Notice(t("Please configure an API key first"));
			return;
		}

		const notice = new Notice(t("Testing connection..."), 0);

		try {
			const { url, headers, body } = adapter.buildRequest(model, apiKey, baseUrl, "test", 10);

			const response = await requestUrl({
				url, method: "POST", headers, body: JSON.stringify(body),
			});

			const data = response.json;
			if (response.status !== 200) {
				throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
			}

			if (isTestResponseValid(protocol, data)) {
				notice.hide();
				new Notice(t("Connection test succeeded: the API response format is valid"), 2000);
			} else {
				throw new Error(t("Connection succeeded but the API response could not be parsed: {{response}}", {
					response: JSON.stringify(data)
				}));
			}
		} catch (error: any) {
			notice.hide();
			console.error("连接测试失败:", error);
			new Notice(t("Connection test failed: {{error}}", { error: error.message }), 5000);
		}
	}

	private showPromptMappingModal(type: 'folder' | 'file') {
		const modal = new Modal(this.ctx.app);
		const target = t(type === 'folder' ? "Folder" : "File");
		const title = t("{{target}} prompt mapping", { target });
		modal.setTitle(title);

		const content = modal.contentEl;

		// 获取当前映射
		let currentMap: Record<string, string>;
		let currentAliasMap: Record<string, string>;
		const ai = this.ctx.getAIConfig();
		if (type === 'folder') {
			currentMap = ai.folderPromptMap || {};
			currentAliasMap = ai.folderAliasPromptMap || {};
		} else {
			currentMap = ai.filePromptMap || {};
			currentAliasMap = ai.fileAliasPromptMap || {};
		}

		// 创建映射列表容器
		const mappingContainer = content.createDiv({ cls: "prompt-mapping-container" });
		mappingContainer.style.maxHeight = "400px";
		mappingContainer.style.overflowY = "auto";
		mappingContainer.style.marginBottom = "20px";

		const refreshMappingList = () => {
			mappingContainer.empty();

			Object.entries(currentMap).forEach(([path, prompt]) => {
				const aliasPrompt = currentAliasMap[path] || '';

				const mappingItem = mappingContainer.createDiv({ cls: "prompt-mapping-item" });
				mappingItem.style.display = "flex";
				mappingItem.style.flexDirection = "column";
				mappingItem.style.gap = "5px";
				mappingItem.style.marginBottom = "15px";
				mappingItem.style.padding = "15px";
				mappingItem.style.border = "1px solid var(--background-modifier-border)";
				mappingItem.style.borderRadius = "5px";

				// 路径标题
				const pathHeader = mappingItem.createDiv();
				pathHeader.style.display = "flex";
				pathHeader.style.justifyContent = "space-between";
				pathHeader.style.alignItems = "center";
				pathHeader.style.marginBottom = "10px";

				const pathSpan = pathHeader.createSpan({ text: path });
				pathSpan.style.fontWeight = "bold";
				pathSpan.style.fontSize = "14px";

				// 按钮组
				const buttonGroup = pathHeader.createDiv();
				buttonGroup.style.display = "flex";
				buttonGroup.style.gap = "5px";

				const editButton = buttonGroup.createEl("button", { text: t("Edit") });
				editButton.style.fontSize = "12px";
				editButton.onclick = () => {
					this.showPromptEditModal(path, prompt, aliasPrompt, (newPrompt, newAliasPrompt) => {
						currentMap[path] = newPrompt;
						currentAliasMap[path] = newAliasPrompt;
						this.savePromptMapping(type, currentMap, currentAliasMap);
						refreshMappingList();
					});
				};

				const deleteButton = buttonGroup.createEl("button", { text: t("Delete") });
				deleteButton.style.backgroundColor = "var(--interactive-accent)";
				deleteButton.style.color = "white";
				deleteButton.style.fontSize = "12px";
				deleteButton.onclick = () => {
					delete currentMap[path];
					delete currentAliasMap[path];
					this.savePromptMapping(type, currentMap, currentAliasMap);
					refreshMappingList();
				};

				// 定义prompt预览
				const defPromptContainer = mappingItem.createDiv();
				defPromptContainer.style.marginBottom = "8px";

				const defPromptLabel = defPromptContainer.createDiv({ text: t("Definition prompt:") });
				defPromptLabel.style.fontSize = "12px";
				defPromptLabel.style.fontWeight = "bold";
				defPromptLabel.style.color = "var(--text-muted)";
				defPromptLabel.style.marginBottom = "3px";

				const defPromptSpan = defPromptContainer.createDiv({ text: prompt.substring(0, 80) + (prompt.length > 80 ? "..." : "") });
				defPromptSpan.style.fontSize = "12px";
				defPromptSpan.style.color = "var(--text-normal)";
				defPromptSpan.style.fontFamily = "monospace";
				defPromptSpan.style.backgroundColor = "var(--background-secondary)";
				defPromptSpan.style.padding = "5px";
				defPromptSpan.style.borderRadius = "3px";

				// 别名prompt预览
				const aliasPromptContainer = mappingItem.createDiv();

				const aliasPromptLabel = aliasPromptContainer.createDiv({ text: t("Alias prompt:") });
				aliasPromptLabel.style.fontSize = "12px";
				aliasPromptLabel.style.fontWeight = "bold";
				aliasPromptLabel.style.color = "var(--text-muted)";
				aliasPromptLabel.style.marginBottom = "3px";

				const aliasPromptSpan = aliasPromptContainer.createDiv({ text: aliasPrompt ? (aliasPrompt.substring(0, 80) + (aliasPrompt.length > 80 ? "..." : "")) : t("Not set") });
				aliasPromptSpan.style.fontSize = "12px";
				aliasPromptSpan.style.color = aliasPrompt ? "var(--text-normal)" : "var(--text-muted)";
				aliasPromptSpan.style.fontFamily = "monospace";
				aliasPromptSpan.style.backgroundColor = "var(--background-secondary)";
				aliasPromptSpan.style.padding = "5px";
				aliasPromptSpan.style.borderRadius = "3px";
			});

			if (Object.keys(currentMap).length === 0) {
				const emptyMessage = mappingContainer.createDiv({ text: t("No mappings configured") });
				emptyMessage.style.textAlign = "center";
				emptyMessage.style.color = "var(--text-muted)";
				emptyMessage.style.padding = "20px";
			}
		};

		refreshMappingList();

		// 添加新映射按钮
		const addButton = content.createEl("button", { text: t("Add {{target}} mapping", { target }) });
		addButton.style.width = "100%";
		addButton.style.marginBottom = "10px";
		addButton.onclick = () => {
			this.showAddMappingModal(type, (path, prompt, aliasPrompt) => {
				currentMap[path] = prompt;
				currentAliasMap[path] = aliasPrompt;
				// 同时保存定义和别名prompt
				this.savePromptMapping(type, currentMap, currentAliasMap);
				refreshMappingList();
			});
		};

		modal.open();
	}

	private showAddMappingModal(type: 'folder' | 'file', onAdd: (path: string, prompt: string, aliasPrompt: string) => void) {
		const modal = new Modal(this.ctx.app);
		const target = t(type === 'folder' ? "Folder" : "File");
		modal.setTitle(t("Add {{target}} mapping", { target }));

		const content = modal.contentEl;

		// 路径选择
		new Setting(content)
			.setName(t(type === 'folder' ? "Folder path" : "File path"))
			.setDesc(t("Select the {{target}} to map", { target }))
			.addDropdown(component => {
				if (type === 'folder') {
					// 获取所有文件夹（简化版本，避免循环依赖）
					const folders = this.ctx.app.vault.getAllLoadedFiles()
						.filter(file => (file as any).children !== undefined) // 只获取文件夹
						.map(folder => folder.path)
						.filter(path => path.length > 0)
						.sort();

					folders.forEach(folderPath => {
						component.addOption(folderPath, folderPath);
					});
				} else {
					// 获取所有markdown文件（简化版本，避免循环依赖）
					const markdownFiles = this.ctx.app.vault.getMarkdownFiles();
					markdownFiles.forEach(file => {
						component.addOption(file.path, file.name);
					});
				}
			});

		// Prompt输入
		let promptTextArea: HTMLTextAreaElement;
		new Setting(content)
			.setName(t("Definition generation prompt"))
			.setDesc(t("Enter the custom prompt for definition generation"))
			.addTextArea(component => {
				promptTextArea = component.inputEl;
				component.inputEl.rows = 6;
				component.inputEl.style.width = '100%';
				component.inputEl.style.resize = 'vertical';
			});

		// 添加定义prompt模板选择
		new Setting(content)
			.setName(t("Definition prompt template"))
			.setDesc(t("Choose a commonly used definition prompt template"))
			.addDropdown(component => {
				component.addOption('', t("Choose a template..."));
				component.addOption('default', t("Default general template"));
				component.addOption('technical', t("Technical term template"));
				component.addOption('academic', t("Academic concept template"));
				component.addOption('business', t("Business term template"));
				component.addOption('medical', t("Medical term template"));
				component.onChange(value => {
					if (value && promptTextArea) {
						promptTextArea.value = DEFINITION_PROMPT_TEMPLATES[value] || '';
					}
				});
			});

		// 别名Prompt输入
		let aliasPromptTextArea: HTMLTextAreaElement;
		new Setting(content)
			.setName(t("Alias generation prompt"))
			.setDesc(t("Enter the custom prompt for alias generation"))
			.addTextArea(component => {
				aliasPromptTextArea = component.inputEl;
				component.inputEl.rows = 6;
				component.inputEl.style.width = '100%';
				component.inputEl.style.resize = 'vertical';
			});

		// 添加别名prompt模板选择
		new Setting(content)
			.setName(t("Alias prompt template"))
			.setDesc(t("Choose a commonly used alias prompt template"))
			.addDropdown(component => {
				component.addOption('', t("Choose a template..."));
				component.addOption('default', t("Default general template"));
				component.addOption('wikipedia', t("Wikipedia style"));
				component.addOption('multilingual', t("Multilingual aliases"));
				component.addOption('abbreviation', t("Focus on abbreviations"));
				component.addOption('synonym', t("Focus on synonyms"));
				component.onChange(value => {
					if (value && aliasPromptTextArea) {
						aliasPromptTextArea.value = ALIAS_PROMPT_TEMPLATES[value] || '';
					}
				});
			});

		// 按钮容器
		const buttonContainer = content.createDiv();
		buttonContainer.style.display = "flex";
		buttonContainer.style.justifyContent = "flex-end";
		buttonContainer.style.gap = "10px";
		buttonContainer.style.marginTop = "20px";

		const cancelButton = buttonContainer.createEl("button", { text: t("Cancel") });
		cancelButton.onclick = () => modal.close();

		const addButton = buttonContainer.createEl("button", { text: t("Add") });
		addButton.addClass("mod-cta");
		addButton.onclick = () => {
			const pathDropdown = content.querySelector('select') as HTMLSelectElement;
			const path = pathDropdown.value;
			const prompt = promptTextArea.value.trim();
			const aliasPrompt = aliasPromptTextArea.value.trim();

			if (!path || !prompt) {
				new Notice(t("Please select a path and enter a definition prompt"));
				return;
			}

			if (!aliasPrompt) {
				new Notice(t("Please enter an alias prompt"));
				return;
			}

			onAdd(path, prompt, aliasPrompt);
			modal.close();
		};

		modal.open();
	}

	private showPromptEditModal(path: string, currentPrompt: string, currentAliasPrompt: string, onSave: (newPrompt: string, newAliasPrompt: string) => void) {
		const modal = new Modal(this.ctx.app);
		const isDefault = path === 'default';
		modal.setTitle(isDefault ? t("Edit default prompts") : t("Edit prompt for {{path}}", { path }));

		const content = modal.contentEl;

		let promptTextArea: HTMLTextAreaElement;
		new Setting(content)
			.setName(t("Definition prompt"))
			.setDesc(isDefault ? t("Default definition prompt description") : t("Edit definition prompt description"))
			.addTextArea(component => {
				promptTextArea = component.inputEl;
				component.setValue(currentPrompt);
				component.inputEl.rows = 6;
				component.inputEl.style.width = '100%';
				component.inputEl.style.resize = 'vertical';
			});


		let aliasPromptTextArea: HTMLTextAreaElement;
		new Setting(content)
			.setName(t("Alias prompt"))
			.setDesc(isDefault ? t("Default alias prompt description") : t("Edit alias prompt description"))
			.addTextArea(component => {
				aliasPromptTextArea = component.inputEl;
				component.setValue(currentAliasPrompt);
				component.inputEl.rows = 6;
				component.inputEl.style.width = '100%';
				component.inputEl.style.resize = 'vertical';
			});


		const buttonContainer = content.createDiv();
		buttonContainer.style.display = "flex";
		buttonContainer.style.justifyContent = "space-between";
		buttonContainer.style.gap = "10px";
		buttonContainer.style.marginTop = "20px";

		// 左侧重置按钮（仅对默认prompt显示）
		const leftButtons = buttonContainer.createDiv();
		if (isDefault) {
			const resetButton = leftButtons.createEl("button", { text: t("Reset to system default") });
			resetButton.onclick = () => {
				promptTextArea.value = DEFAULT_DEFINITION_PROMPT;
				aliasPromptTextArea.value = DEFAULT_ALIAS_PROMPT;
			};
		}

		// 右侧按钮组
		const rightButtons = buttonContainer.createDiv();
		rightButtons.style.display = "flex";
		rightButtons.style.gap = "10px";

		const cancelButton = rightButtons.createEl("button", { text: t("Cancel") });
		cancelButton.onclick = () => modal.close();

		const saveButton = rightButtons.createEl("button", { text: t("Save") });
		saveButton.addClass("mod-cta");
		saveButton.onclick = () => {
			const newPrompt = promptTextArea.value.trim();
			const newAliasPrompt = aliasPromptTextArea.value.trim();

			if (!newPrompt) {
				new Notice(t("Please enter a definition prompt"));
				return;
			}

			if (!newAliasPrompt) {
				new Notice(t("Please enter an alias prompt"));
				return;
			}

			onSave(newPrompt, newAliasPrompt);
			modal.close();
		};

		modal.open();
	}

	private async savePromptMapping(type: 'folder' | 'file', mapping: Record<string, string>, aliasMapping: Record<string, string> = {}) {
		this.ensureAIConfig();
		const ai = this.ctx.getAIConfig();

		if (type === 'folder') {
			ai.folderPromptMap = mapping;
			ai.folderAliasPromptMap = aliasMapping;
		} else {
			ai.filePromptMap = mapping;
			ai.fileAliasPromptMap = aliasMapping;
		}

		await this.ctx.saveCallback();
	}
}
