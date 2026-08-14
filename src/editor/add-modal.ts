import { App, DropdownComponent, Modal, Notice, Setting, setIcon } from "obsidian";
import { getDefFileManager, DefManager } from "src/core/def-file-manager";
import { DefFileUpdater } from "src/core/def-file-updater";
import { DefFileType } from "src/core/file-type";
import { FileParser } from "src/core/file-parser";
import { AIService } from "src/ai/ai-service";
import { AIConfig } from "src/settings";
import { getProtocol } from "src/ai/providers";
import { t } from "src/i18n";
import {
	DefinitionCandidate,
	formatEcdictExamTag,
	formatDefinitionCandidate,
	getEcdictStore,
	getDefinitionSourceMetadata,
	getDefinitionSourceRegistry,
} from "src/sources";

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
	private saveCallback?: () => Promise<void>;

	constructor(app: App, saveCallback?: () => Promise<void>) {
		this.app = app;
		this.modal = new Modal(app);
		this.saveCallback = saveCallback;
		this.aiService = new AIService(this.getAIConfig(), app);
	}

	private getAIConfig(): AIConfig {
		const settings = window.NoteDefinition?.settings;

		if (!settings?.aiConfig) {
			return {
				enabled: true,
				providers: [],
				folderPromptMap: {},
				filePromptMap: {},
				folderAliasPromptMap: {},
				fileAliasPromptMap: {}
			};
		}

		// 确保enabled字段存在且为true
		const aiConfig: AIConfig = { ...settings.aiConfig };
		if (aiConfig.enabled === undefined || aiConfig.enabled === null) {
			aiConfig.enabled = true;
		}
		if (!Array.isArray(aiConfig.providers)) {
			aiConfig.providers = [];
		}

		return aiConfig;
	}

	open(text?: string, context?: string) {
		this.submitting = false;
		
		// 更新AI服务配置，确保获取最新的映射设置
		this.aiService.updateConfig(this.getAIConfig());
		
		this.modal.setTitle(t("Add Definition"));
		
		// 清空默认标题并创建自定义标题栏
		this.modal.titleEl.empty();

		const titleContainer = this.modal.titleEl.createDiv({ cls: "modal-title-with-ai" });
		titleContainer.style.display = "flex";
		titleContainer.style.alignItems = "center";
		titleContainer.style.gap = "8px";

		const titleText = titleContainer.createSpan({
			text: t("Add Definition"),
			cls: "modal-title-text"
		});
		titleText.style.fontSize = "var(--modal-title-size)";
		titleText.style.fontWeight = "var(--modal-title-weight)";

		// 右侧控件容器
		const rightControls = titleContainer.createDiv();
		rightControls.style.display = "flex";
		rightControls.style.alignItems = "center";
		rightControls.style.gap = "6px";
		rightControls.style.marginLeft = "auto";
		rightControls.style.marginRight = "36px";

		// ── AI 按钮 ──
		const aiButton = rightControls.createEl("button", {
			cls: "mod-cta",
			attr: { title: t("Generate definition and aliases with AI (prompts can be customized in settings)") }
		});
		aiButton.style.padding = "3px 10px";
		aiButton.style.fontSize = "12px";
		aiButton.style.height = "auto";
		aiButton.style.display = "flex";
		aiButton.style.alignItems = "center";
		aiButton.style.gap = "3px";
		aiButton.createSpan({ text: "✨" });
		aiButton.createSpan({ text: t("AI") });

		// ── 上下文感知 toggle ──
		const hasContext = !!(context && context.trim());
		let contextEnabled = hasContext && (this.getAIConfig().contextAwareEnabled !== false);

		const contextToggle = rightControls.createDiv();
		contextToggle.style.display = "flex";
		contextToggle.style.alignItems = "center";
		contextToggle.style.gap = "5px";
		contextToggle.style.cursor = hasContext ? "pointer" : "default";
		contextToggle.style.padding = "3px 8px";
		contextToggle.style.borderRadius = "6px";
		contextToggle.style.background = "var(--background-secondary)";

		if (hasContext) {
			const preview = context!.trim().substring(0, 200) + (context!.trim().length > 200 ? '...' : '');
			contextToggle.setAttr("title", `${t("Toggle context awareness")}\n\n${preview}`);
		} else {
			contextToggle.setAttr("title", t("No context available"));
			contextToggle.style.opacity = "0.4";
			contextToggle.style.pointerEvents = "none";
		}

		const contextLabel = contextToggle.createSpan({ text: t("Context") });
		contextLabel.style.fontSize = "11px";

		const contextDot = contextToggle.createDiv();
		contextDot.style.width = "8px";
		contextDot.style.height = "8px";
		contextDot.style.borderRadius = "50%";
		contextDot.style.flexShrink = "0";

		const updateContextToggle = () => {
			if (contextEnabled) {
				contextDot.style.background = "var(--interactive-accent)";
				contextLabel.style.color = "var(--interactive-accent)";
				contextDot.style.boxShadow = "0 0 0 2px var(--interactive-accent-hover)";
			} else {
				contextDot.style.background = "var(--text-faint)";
				contextLabel.style.color = "var(--text-muted)";
				contextDot.style.boxShadow = "none";
			}
		};

		if (hasContext) {
			contextToggle.onclick = () => {
				contextEnabled = !contextEnabled;
				updateContextToggle();
			};
		}
		if (!hasContext) contextEnabled = false;
		updateContextToggle();

		// ── 设置按钮 ──
		const settingsButton = rightControls.createEl("button", {
			cls: "ai-settings-button-inline",
			attr: {
				"aria-label": t("View and edit the current prompt settings"),
				title: t("View and edit the current prompt settings")
			}
		});
		settingsButton.style.padding = "3px";
		settingsButton.style.width = "26px";
		settingsButton.style.height = "26px";
		settingsButton.style.display = "flex";
		settingsButton.style.alignItems = "center";
		settingsButton.style.justifyContent = "center";
		setIcon(settingsButton, "settings");
		
		// 添加设置按钮点击事件
		settingsButton.addEventListener('click', () => {
			this.showPromptSettingsModal();
		});
		
		// ── 单栏布局 ──
		const contentContainer = this.modal.contentEl;

		const phraseHeader = contentContainer.createDiv({
			cls: "edit-modal-section-header definition-lookup-heading",
		});
		phraseHeader.createSpan({ text: t("Word/Phrase") });
		const lookupButton = phraseHeader.createEl("button", {
			cls: "definition-lookup-button",
			attr: {
				title: t("Look up definition candidates from enabled sources"),
				"aria-label": t("Look up definition candidates from enabled sources"),
			},
		});
		const lookupButtonIcon = lookupButton.createSpan({ cls: "definition-lookup-button-icon" });
		setIcon(lookupButtonIcon, "search");
		lookupButton.createSpan({ text: t("Look up") });
		const phraseText = contentContainer.createEl("textarea", {
			cls: 'edit-modal-aliases',
			attr: {
				placeholder: t("Word/phrase to be defined")
			},
			text: text ?? ''
		});
		const lookupResults = contentContainer.createDiv({ cls: "definition-lookup-results" });
		lookupResults.hide();

		contentContainer.createDiv({
			cls: "edit-modal-section-header",
			text: t("Aliases")
		})
		const aliasText = contentContainer.createEl("textarea", {
			cls: 'edit-modal-aliases',
			attr: {
				placeholder: t("Add comma-separated aliases here")
			},
		});

		contentContainer.createDiv({
			cls: "edit-modal-section-header",
			text: t("Definition")
		});
		const defText = contentContainer.createEl("textarea", {
			cls: 'edit-modal-textarea',
			attr: {
				placeholder: t("Add definition here")
			},
		});

		lookupButton.addEventListener("click", async () => {
			const term = phraseText.value.trim();
			if (!term) {
				new Notice(t("Please enter a word or phrase first"));
				return;
			}

			const config = window.NoteDefinition.settings.definitionSourcesConfig;
			const hasEnabledSource = Object.values(config.sources).some(source => source.enabled);
			if (!hasEnabledSource) {
				new Notice(t("Please enable at least one definition source in settings"));
				return;
			}

			this.setLookupButtonLoading(lookupButton, true);
			lookupResults.show();
			lookupResults.empty();
			const lookupStatus = lookupResults.createDiv({
				cls: "definition-lookup-loading",
				text: t("Looking up definitions..."),
			});
			let stopEcdictProgress: (() => void) | undefined;

			try {
				if (config.sources.ecdict?.enabled) {
					const ecdictStore = getEcdictStore(this.app);
					const status = await ecdictStore.getStatus();
					if (!status.installed) {
						lookupStatus.setText(t("Downloading and indexing ECDICT... {{percent}}%", { percent: 0 }));
						stopEcdictProgress = ecdictStore.onProgress(progress => {
							const percent = Math.min(100, Math.round(
								progress.processedBytes / progress.totalBytes * 100,
							));
							lookupStatus.setText(t("Downloading and indexing ECDICT... {{percent}}%", { percent }));
						});
					}
				}
				const result = await getDefinitionSourceRegistry(this.app).lookup({
					term,
					language: config.preferredLanguage,
					context: contextEnabled ? context : undefined,
					limit: 6,
				}, config);

				result.failures.forEach(failure => {
					console.warn(`Definition source ${failure.sourceId} failed`, failure.error);
				});

				this.renderDefinitionCandidates(
					lookupResults,
					result.candidates,
					result.failures.length,
					candidate => {
						this.applyDefinitionCandidate(candidate, phraseText, aliasText, defText);
					},
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				lookupResults.empty();
				lookupResults.createDiv({
					cls: "definition-lookup-empty",
					text: t("Definition lookup failed: {{error}}", { error: message }),
				});
				new Notice(t("Definition lookup failed: {{error}}", { error: message }));
			} finally {
				stopEcdictProgress?.();
				this.setLookupButtonLoading(lookupButton, false);
			}
		});

		// AI按钮点击事件 — 直接填充到定义和别名框
		aiButton.addEventListener('click', async () => {
			const word = phraseText.value.trim();
			if (!word) {
				new Notice(t("Please enter a word or phrase first"));
				return;
			}

			const entry = this.aiService.getActiveProvider();
			if (!entry) {
				new Notice(t("Please configure an AI provider in the plugin settings first"));
				return;
			}

			const adapter = getProtocol(entry.protocol);
			if (adapter?.needsApiKey) {
				const apiKey = this.aiService.getApiKey(entry);
				if (!apiKey) {
					new Notice(t("Please configure an API key in the plugin settings first"));
					return;
				}
			}

			// 获取当前选择的文件类型和路径
			const fileType = this.fileTypePicker.getValue();
			let targetPath = '';

			if (fileType === 'atomic') {
				targetPath = this.atomicFolderPicker.getValue().replace(/\/$/, '');
			} else if (fileType === 'consolidated') {
				targetPath = this.defFilePicker.getValue();
			}

			// 显示加载状态
			aiButton.setText(`🔄 ${t("Generating...")}`);
			aiButton.disabled = true;
			aiButton.style.backgroundColor = "#a0a0a0";

			try {
				const [definition, aliases] = await Promise.all([
					this.aiService.generateDefinition(word, fileType, targetPath, contextEnabled ? context : undefined),
					this.aiService.generateAliases(word, fileType, targetPath, contextEnabled ? context : undefined)
				]);

				const safeDefinition = (definition || "").trim();
				const safeAliases = Array.isArray(aliases) ? aliases.filter(a => typeof a === "string" && a.trim()) : [];

				if (!safeDefinition && safeAliases.length === 0) {
					new Notice(t("AI returned neither a definition nor aliases. Please retry or check the configuration."));
					return;
				}

				// 直接填充到定义和别名框
				if (safeDefinition) {
					defText.value = safeDefinition;
				}

				if (!aliasText.value.trim() && safeAliases.length > 0) {
					aliasText.value = safeAliases.join(', ');
				}

				defText.focus();

			} catch (error) {
				console.error("AI生成失败详细信息:", error);
				const errorMessage = error instanceof Error ? error.message : String(error);
				new Notice(`❌ ${t("AI generation failed: {{error}}", { error: errorMessage })}`);
			} finally {
				aiButton.setText("✨ AI");
				aiButton.disabled = false;
				aiButton.style.backgroundColor = "";
			}
		});

		new Setting(contentContainer)
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
		this.consolidatedSubfolderPickerSetting = new Setting(contentContainer)
			.setName(t("Subfolder"))
			.addDropdown(component => {
			const sortedPaths = this.getSubfolderPaths();
			sortedPaths.forEach(folderPath => {
				component.addOption(folderPath, folderPath);
			});

			this.consolidatedSubfolderPicker = component;
				
				// 监听子文件夹选择变化，更新定义文件列表
				component.onChange((selectedFolder) => {
					this.refreshDefFileDropdown(selectedFolder);
				});
			});

		this.defFilePickerSetting = new Setting(contentContainer)
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

		this.atomicFolderPickerSetting = new Setting(contentContainer)
			.setName(t("Add file to folder"))
			.addDropdown(component => {
			const sortedPaths = this.getSubfolderPaths();
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

		const button = contentContainer.createEl("button", {
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

	private setLookupButtonLoading(button: HTMLButtonElement, loading: boolean): void {
		button.disabled = loading;
		button.empty();
		const icon = button.createSpan({ cls: "definition-lookup-button-icon" });
		setIcon(icon, loading ? "loader-circle" : "search");
		if (loading) icon.addClass("definition-lookup-spinner");
		button.createSpan({ text: loading ? t("Looking up...") : t("Look up") });
	}

	private renderDefinitionCandidates(
		container: HTMLElement,
		candidates: DefinitionCandidate[],
		failureCount: number,
		onSelect: (candidate: DefinitionCandidate) => void,
	): void {
		container.empty();
		if (candidates.length === 0) {
			container.createDiv({
				cls: "definition-lookup-empty",
				text: failureCount > 0
					? t("No candidates found; {{count}} sources failed", { count: failureCount })
					: t("No definition candidates found"),
			});
			return;
		}

		container.createDiv({
			cls: "definition-lookup-results-title",
			text: t("Definition candidates ({{count}})", { count: candidates.length }),
		});

		for (const candidate of candidates) {
			const metadata = getDefinitionSourceMetadata(candidate.sourceId);
			const card = container.createDiv({ cls: "definition-lookup-card" });
			const cardHeader = card.createDiv({ cls: "definition-lookup-card-header" });
			const heading = cardHeader.createDiv({ cls: "definition-lookup-card-heading" });
			heading.createSpan({ text: candidate.word, cls: "definition-lookup-card-word" });
			heading.createSpan({ text: metadata.name, cls: "definition-lookup-source-badge" });
			const details = [candidate.entryLanguage, candidate.language.toUpperCase()]
				.filter(Boolean)
				.join(" · ");
			if (details) {
				heading.createDiv({ text: details, cls: "definition-lookup-card-language" });
			}

			const useButton = cardHeader.createEl("button", {
				text: t("Use candidate"),
				cls: "definition-lookup-use-button",
			});
			useButton.addEventListener("click", () => onSelect(candidate));

			if (candidate.pronunciations && candidate.pronunciations.length > 0) {
				card.createDiv({
					cls: "definition-lookup-card-pronunciation",
					text: candidate.pronunciations
						.map(value => `/${value.text}/`)
						.join(" · "),
				});
			}

			const visibleSenses = candidate.senses.slice(0, 3);
			if (visibleSenses.length > 0) {
				const sensesEl = card.createDiv({ cls: "definition-lookup-card-senses" });
				visibleSenses.forEach(sense => {
					const senseEl = sensesEl.createDiv({ cls: "definition-lookup-card-sense" });
					if (sense.partOfSpeech) {
						senseEl.createSpan({ text: sense.partOfSpeech, cls: "definition-lookup-pos" });
					}
					senseEl.createSpan({ text: sense.definition });
				});
				if (candidate.senses.length > visibleSenses.length) {
					sensesEl.createDiv({
						cls: "definition-lookup-more",
						text: t("{{count}} more senses", {
							count: candidate.senses.length - visibleSenses.length,
						}),
					});
				}
			}

			if (candidate.englishSenses && candidate.englishSenses.length > 0) {
				card.createDiv({
					cls: "definition-lookup-card-extra",
					text: `${t("English definition")}: ${candidate.englishSenses
						.slice(0, 2)
						.map(sense => `${sense.partOfSpeech ? `${sense.partOfSpeech} ` : ""}${sense.definition}`)
						.join("; ")}`,
				});
			}

			const vocabularyInfoLabel = t("Vocabulary information");
			const useChineseTags = /[\u3400-\u9fff]/.test(vocabularyInfoLabel);
			const vocabularyInfo = [
				candidate.oxford3000 ? `#${t("Oxford 3000").replace(/\s+/g, "")}` : "",
				...(candidate.examTags || []).map(tag =>
					`#${formatEcdictExamTag(tag, useChineseTags)
						.replace(/\s+/g, useChineseTags ? "" : "-")}`),
			].filter(Boolean);
			if (vocabularyInfo.length > 0) {
				card.createDiv({
					cls: "definition-lookup-card-extra",
					text: `${vocabularyInfoLabel}: ${vocabularyInfo.join(" ")}`,
				});
			}

			if (candidate.aliases.length > 0) {
				card.createDiv({
					cls: "definition-lookup-card-aliases",
					text: `${t("Aliases")}: ${candidate.aliases.slice(0, 8).join(", ")}`,
				});
			}

			if (candidate.sourceUrl && candidate.sourceId !== "ecdict") {
				const sourceLink = card.createEl("a", {
					text: t("Open source page"),
					href: candidate.sourceUrl,
					cls: "definition-lookup-source-link",
				});
				sourceLink.setAttr("target", "_blank");
				sourceLink.setAttr("rel", "noopener noreferrer");
			}
		}

		if (failureCount > 0) {
			container.createDiv({
				cls: "definition-lookup-warning",
				text: t("{{count}} definition sources failed; results from other sources are still shown", {
					count: failureCount,
				}),
			});
		}
	}

	private applyDefinitionCandidate(
		candidate: DefinitionCandidate,
		phraseText: HTMLTextAreaElement,
		aliasText: HTMLTextAreaElement,
		defText: HTMLTextAreaElement,
	): void {
		const term = phraseText.value.trim();
		const existingAliases = aliasText.value
			.split(/[,，]/)
			.map(alias => alias.trim())
			.filter(Boolean);
		const incomingAliases = candidate.word !== term
			? [candidate.word, ...candidate.aliases]
			: candidate.aliases;
		const seen = new Set<string>();
		const aliases = [...existingAliases, ...incomingAliases].filter(alias => {
			const key = alias.toLocaleLowerCase();
			if (!key || key === term.toLocaleLowerCase() || seen.has(key)) return false;
			seen.add(key);
			return true;
		});
		aliasText.value = aliases.join(", ");

		if (candidate.senses.length > 0) {
			defText.value = formatDefinitionCandidate(candidate, {
				example: t("Example"),
				source: t("Source"),
				meaning: t("Meaning"),
				phonetic: t("Phonetic"),
				englishDefinition: t("English definition"),
				vocabularyInfo: t("Vocabulary information"),
				oxford3000: t("Oxford 3000"),
			});
		}
		defText.focus();
		new Notice(t("Definition candidate applied"));
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

		const sortedPaths = this.getSubfolderPaths();
		sortedPaths.forEach(folderPath => {
			this.atomicFolderPicker.addOption(folderPath, folderPath + "/");
		});
	}

	private getSubfolderPaths(): string[] {
		const defManager = getDefFileManager();
		const defFolders = defManager.getDefFolders();
		const allPaths: Set<string> = new Set();

		// Add main def folders
		defFolders.forEach(folder => {
			allPaths.add(folder.path);
		});

		// Get all files once, then build subfolder paths
		const allFiles = this.app.vault.getFiles();
		defFolders.forEach(folder => {
			allFiles.forEach(file => {
				if (file.path.startsWith(folder.path + "/")) {
					const relativePath = file.path.substring(folder.path.length + 1);
					const pathParts = relativePath.split("/");

					if (pathParts.length > 1) {
						let currentPath = folder.path;
						for (let i = 0; i < pathParts.length - 1; i++) {
							currentPath += "/" + pathParts[i];
							allPaths.add(currentPath);
						}
					}
				}
			});
		});

		return Array.from(allPaths).sort();
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
		aliasPromptTextArea.value = isUsingMappedAliasPrompt ? currentAliasPrompt : '';
		aliasPromptTextArea.setAttribute("placeholder", t("Enter custom prompt for this path, or leave empty to use system default"));
		aliasPromptTextArea.style.width = "100%";
		aliasPromptTextArea.style.height = "120px";
		aliasPromptTextArea.style.resize = "vertical";
		aliasPromptTextArea.style.fontFamily = "monospace";
		aliasPromptTextArea.style.fontSize = "12px";

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
		defPromptTextArea.value = isUsingMappedDefPrompt ? currentDefinitionPrompt : '';
		defPromptTextArea.setAttribute("placeholder", t("Enter custom prompt for this path, or leave empty to use system default"));
		defPromptTextArea.style.width = "100%";
		defPromptTextArea.style.height = "120px";
		defPromptTextArea.style.resize = "vertical";
		defPromptTextArea.style.fontFamily = "monospace";
		defPromptTextArea.style.fontSize = "12px";

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

			const defValue = defPromptTextArea.value.trim();
			const aliasValue = aliasPromptTextArea.value.trim();

			// 两者都为空时，删除该路径的映射（回退到系统默认）
			if (!defValue && !aliasValue) {
				const newConfig = { ...this.aiService.aiConfig };
				if (fileType === 'atomic') {
					delete newConfig.folderPromptMap?.[targetPath];
					delete newConfig.folderAliasPromptMap?.[targetPath];
				} else {
					delete newConfig.filePromptMap?.[targetPath];
					delete newConfig.fileAliasPromptMap?.[targetPath];
				}
				this.aiService.updateConfig(newConfig);
				const settings = window.NoteDefinition.settings;
				if (settings.aiConfig) {
					settings.aiConfig.folderPromptMap = newConfig.folderPromptMap;
					settings.aiConfig.filePromptMap = newConfig.filePromptMap;
					settings.aiConfig.folderAliasPromptMap = newConfig.folderAliasPromptMap;
					settings.aiConfig.fileAliasPromptMap = newConfig.fileAliasPromptMap;
				}
				if (this.saveCallback) await this.saveCallback();
				new Notice(`✅ ${t("Prompt mapping cleared, using system default")}`);
				modal.close();
				return;
			}

			// 更新AI服务配置
			const newConfig = { ...this.aiService.aiConfig };
			
			if (fileType === 'atomic') {
				if (!newConfig.folderPromptMap) newConfig.folderPromptMap = {};
				if (!newConfig.folderAliasPromptMap) newConfig.folderAliasPromptMap = {};
				if (defValue) newConfig.folderPromptMap[targetPath] = defValue;
				else delete newConfig.folderPromptMap[targetPath];
				if (aliasValue) newConfig.folderAliasPromptMap[targetPath] = aliasValue;
				else delete newConfig.folderAliasPromptMap[targetPath];
			} else {
				if (!newConfig.filePromptMap) newConfig.filePromptMap = {};
				if (!newConfig.fileAliasPromptMap) newConfig.fileAliasPromptMap = {};
				if (defValue) newConfig.filePromptMap[targetPath] = defValue;
				else delete newConfig.filePromptMap[targetPath];
				if (aliasValue) newConfig.fileAliasPromptMap[targetPath] = aliasValue;
				else delete newConfig.fileAliasPromptMap[targetPath];
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

			// 触发设置保存
			if (this.saveCallback) {
				await this.saveCallback();
			}
			new Notice(`✅ ${t("Prompt mapping saved")}`);
			modal.close();
		};

		modal.open();
	}
}
