import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, setTooltip, requestUrl } from "obsidian";
import { DefFileType } from "./core/file-type";
import { t } from "./i18n";

// 内置Prompt常量
export const DEFAULT_DEFINITION_PROMPT = t("Default definition AI prompt");

export const DEFAULT_ALIAS_PROMPT = t("Default alias AI prompt");

// Prompt模板常量
export const DEFINITION_PROMPT_TEMPLATES: Record<string, string> = {
	'default': DEFAULT_DEFINITION_PROMPT,
	'technical': t("Technical definition AI prompt"),
	'academic': t("Academic definition AI prompt"),
	'business': t("Business definition AI prompt"),
	'medical': t("Medical definition AI prompt")
};

export const ALIAS_PROMPT_TEMPLATES: Record<string, string> = {
	'default': DEFAULT_ALIAS_PROMPT,
	'wikipedia': t("Wikipedia alias AI prompt"),
	'multilingual': t("Multilingual alias AI prompt"),
	'abbreviation': t("Abbreviation alias AI prompt"),
	'synonym': t("Synonym alias AI prompt")
};

export enum PopoverEventSettings {
	Hover = "hover",
	Click = "click"
}

export enum PopoverDismissType {
	Click = "click",
	MouseExit = "mouse_exit"
}

export interface DividerSettings {
	dash: boolean;
	underscore: boolean;
}

export interface DefFileParseConfig {
	defaultFileType: DefFileType;
	divider: DividerSettings;
	autoPlurals: boolean;
}

export interface DefinitionPopoverConfig {
	displayAliases: boolean;
	displayDefFileName: boolean;
	enableCustomSize: boolean;
	maxWidth: number;
	maxHeight: number;
	popoverDismissEvent: PopoverDismissType;
	enableDefinitionLink: boolean;
	backgroundColour?: string;
}

export interface ProviderConfig {
	apiKey?: string;
	model?: string;
	baseUrl?: string;
}

export interface AIConfig {
	enabled: boolean;
	currentProvider?: string; // 当前选择的提供商
	customPrompt?: string;
	customAliasPrompt?: string;
	// 按提供商分别存储配置
	providers?: {
		openai?: ProviderConfig;
		gemini?: ProviderConfig;
		ollama?: ProviderConfig;
		custom?: ProviderConfig;
		zhipu?: ProviderConfig;
	};
	// Prompt映射功能 - 分别存储定义和别名prompt
	folderPromptMap?: Record<string, string>; // 文件夹路径 -> 定义prompt (for atomic)
	filePromptMap?: Record<string, string>;   // 文件路径 -> 定义prompt (for consolidated)
	folderAliasPromptMap?: Record<string, string>; // 文件夹路径 -> 别名prompt (for atomic)
	fileAliasPromptMap?: Record<string, string>;   // 文件路径 -> 别名prompt (for consolidated)
}

export interface Settings {
	enableInReadingView: boolean;
	enableSpellcheck: boolean;
	defFolder: string;
	popoverEvent: PopoverEventSettings;
	defFileParseConfig: DefFileParseConfig;
	defPopoverConfig: DefinitionPopoverConfig;
	aiConfig?: AIConfig;
}

export const DEFAULT_DEF_FOLDER = "definitions"

export const DEFAULT_SETTINGS: Partial<Settings> = {
	enableInReadingView: true,
	enableSpellcheck: true,
	popoverEvent: PopoverEventSettings.Hover,
	defFileParseConfig: {
		defaultFileType: DefFileType.Consolidated,
		divider: {
			dash: true,
			underscore: false
		},
		autoPlurals: false
	},
	defPopoverConfig: {
		displayAliases: true,
		displayDefFileName: false,
		enableCustomSize: false,
		maxWidth: 100,
		maxHeight: 100,
		popoverDismissEvent: PopoverDismissType.Click,
		enableDefinitionLink: false,
	},
	aiConfig: {
		enabled: true,
		currentProvider: 'openai',
		customPrompt: DEFAULT_DEFINITION_PROMPT,
		customAliasPrompt: DEFAULT_ALIAS_PROMPT,
		providers: {
			openai: {
				apiKey: '',
				model: 'gpt-3.5-turbo',
				baseUrl: ''
			},
			gemini: {
				apiKey: '',
				model: 'gemini-pro',
				baseUrl: ''
			},
			ollama: {
				apiKey: '',
				model: 'llama3.2',
				baseUrl: 'http://localhost:11434'
			},
			zhipu: {
				apiKey: '',
				model: 'glm-4',
				baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
			},
			custom: {
				apiKey: '',
				model: '',
				baseUrl: ''
			}
		},
		folderPromptMap: {},
		filePromptMap: {},
		folderAliasPromptMap: {},
		fileAliasPromptMap: {}
	}
}

export class SettingsTab extends PluginSettingTab {
	plugin: Plugin;
	settings: Settings;
	saveCallback: () => Promise<void>;

	constructor(app: App, plugin: Plugin, saveCallback: () => Promise<void>) {
		super(app, plugin);
		this.plugin = plugin;
		this.settings = window.NoteDefinition.settings;
		this.saveCallback = saveCallback;
	}

	display(): void {
		let { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName(t("Enable in Reading View"))
			.setDesc(t("Allow defined phrases and definition popovers to be shown in Reading View"))
			.addToggle((component) => {
				component.setValue(this.settings.enableInReadingView);
				component.onChange(async (val) => {
					this.settings.enableInReadingView = val;
					await this.saveCallback();
				});
			});
		new Setting(containerEl)
			.setName(t("Enable spellcheck for defined words"))
			.setDesc(t("Allow defined words and phrases to be spellchecked"))
			.addToggle((component) => {
				component.setValue(this.settings.enableSpellcheck);
				component.onChange(async (val) => {
					this.settings.enableSpellcheck = val;
					await this.saveCallback();
				});
			});

		new Setting(containerEl)
			.setName(t("Definitions folder"))
			.setDesc(t("Files within this folder will be parsed to register definitions"))
			.addText((component) => {
				component.setValue(this.settings.defFolder);
				component.setPlaceholder(DEFAULT_DEF_FOLDER);
				component.setDisabled(true)
				setTooltip(component.inputEl,
					t("Definition folder help"),
					{
						delay: 100
					});
			});
		new Setting(containerEl)
			.setName(t("Definition file format settings"))
			.setDesc(t("Customise parsing rules for definition files"))
			.addExtraButton(component => {
				component.onClick(() => {
					const modal = new Modal(this.app);
					modal.setTitle(t("Definition file format settings"))
					new Setting(modal.contentEl)
						.setName(t("Divider"))
						.setHeading()
					new Setting(modal.contentEl)
						.setName(t("Dash"))
						.setDesc(t("Use triple dash (---) as divider"))
						.addToggle((component) => {
							component.setValue(this.settings.defFileParseConfig.divider.dash);
							component.onChange(async value => {
								if (!value && !this.settings.defFileParseConfig.divider.underscore) {
									new Notice(t("At least one divider must be chosen"), 2000);
									component.setValue(this.settings.defFileParseConfig.divider.dash);
									return;
								}
								this.settings.defFileParseConfig.divider.dash = value;
								await this.saveCallback();
							});
						});
					new Setting(modal.contentEl)
						.setName(t("Underscore"))
						.setDesc(t("Use triple underscore (___) as divider"))
						.addToggle((component) => {
							component.setValue(this.settings.defFileParseConfig.divider.underscore);
							component.onChange(async value => {
								if (!value && !this.settings.defFileParseConfig.divider.dash) {
									new Notice(t("At least one divider must be chosen"), 2000);
									component.setValue(this.settings.defFileParseConfig.divider.underscore);
									return;
								}
								this.settings.defFileParseConfig.divider.underscore = value;
								await this.saveCallback();
							});
						});
					modal.open();
				})
			});

		new Setting(containerEl)
			.setName(t("Default definition file type"))
			.setDesc(t("Default definition file type description"))
			.addDropdown(component => {
				component.addOption(DefFileType.Consolidated, t("Consolidated"));
				component.addOption(DefFileType.Atomic, t("Atomic"));
				component.setValue(this.settings.defFileParseConfig.defaultFileType ?? DefFileType.Consolidated);
				component.onChange(async val => {
					this.settings.defFileParseConfig.defaultFileType = val as DefFileType;
					await this.saveCallback();
				});
			});

		new Setting(containerEl)
			.setName(t("Automatically detect plurals — English only"))
			.setDesc(t("Attempt to automatically generate aliases for words using English pluralisation rules"))
			.addToggle((component) => {
				component.setValue(this.settings.defFileParseConfig.autoPlurals);
				component.onChange(async (val) => {
					this.settings.defFileParseConfig.autoPlurals = val;
					await this.saveCallback();
				});
			});

		new Setting(containerEl)
			.setHeading()
			.setName(t("Definition popover settings"));

		new Setting(containerEl)
			.setName(t("Definition popover display event"))
			.setDesc(t("Choose the trigger event for displaying the definition popover"))
			.addDropdown((component) => {
				component.addOption(PopoverEventSettings.Hover, t("Hover"));
				component.addOption(PopoverEventSettings.Click, t("Click"));
				component.setValue(this.settings.popoverEvent);
				component.onChange(async value => {
					if (value === PopoverEventSettings.Hover || value === PopoverEventSettings.Click) {
						this.settings.popoverEvent = value;
					}
					if (this.settings.popoverEvent === PopoverEventSettings.Click) {
						this.settings.defPopoverConfig.popoverDismissEvent = PopoverDismissType.Click;
					}
					await this.saveCallback();
					this.display();
				});
			});

		if (this.settings.popoverEvent === PopoverEventSettings.Hover) {
			new Setting(containerEl)
				.setName(t("Definition popover dismiss event"))
				.setDesc(t("Configure how the definition popover is closed or dismissed."))
				.addDropdown(component => {
					component.addOption(PopoverDismissType.Click, t("Click"));
					component.addOption(PopoverDismissType.MouseExit, t("Mouse exit"))
					if (!this.settings.defPopoverConfig.popoverDismissEvent) {
						this.settings.defPopoverConfig.popoverDismissEvent = PopoverDismissType.Click;
						this.saveCallback();
					}
					component.setValue(this.settings.defPopoverConfig.popoverDismissEvent);
					component.onChange(async value => {
						if (value === PopoverDismissType.MouseExit || value === PopoverDismissType.Click) {
							this.settings.defPopoverConfig.popoverDismissEvent = value;
						}
						await this.saveCallback();
					});
				});
		}

		new Setting(containerEl)
			.setName(t("Display aliases"))
			.setDesc(t("Display the list of aliases configured for the definition"))
			.addToggle(component => {
				component.setValue(this.settings.defPopoverConfig.displayAliases);
				component.onChange(async value => {
					this.settings.defPopoverConfig.displayAliases = value;
					await this.saveCallback();
				});
			});


		new Setting(containerEl)
			.setName(t("Display definition source file"))
			.setDesc(t("Display the title of the definition's source file"))
			.addToggle(component => {
				component.setValue(this.settings.defPopoverConfig.displayDefFileName);
				component.onChange(async value => {
					this.settings.defPopoverConfig.displayDefFileName = value;
					await this.saveCallback();
				});
			});

		new Setting(containerEl)
			.setName(t("Custom popover size"))
			.setDesc(t("Custom popover size description"))
			.addToggle(component => {
				component.setValue(this.settings.defPopoverConfig.enableCustomSize);
				component.onChange(async value => {
					this.settings.defPopoverConfig.enableCustomSize = value;
					await this.saveCallback();
					this.display();
				});
			});

		if (this.settings.defPopoverConfig.enableCustomSize) {
			new Setting(containerEl)
				.setName(t("Popover width (px)"))
				.setDesc(t("Maximum width of the definition popover"))
				.addSlider(component => {
					component.setLimits(150, window.innerWidth, 1);
					component.setValue(this.settings.defPopoverConfig.maxWidth);
					component.setDynamicTooltip()
					component.onChange(async val => {
						this.settings.defPopoverConfig.maxWidth = val;
						await this.saveCallback();
					});
				});

			new Setting(containerEl)
				.setName(t("Popover height (px)"))
				.setDesc(t("Maximum height of the definition popover"))
				.addSlider(component => {
					component.setLimits(150, window.innerHeight, 1);
					component.setValue(this.settings.defPopoverConfig.maxHeight);
					component.setDynamicTooltip();
					component.onChange(async val => {
						this.settings.defPopoverConfig.maxHeight = val;
						await this.saveCallback();
					});
				});
		}

		new Setting(containerEl)
			.setName(t("Enable definition links"))
			.setDesc(t("Definitions within popovers will be marked and can be clicked to go to definition."))
			.addToggle(component => {
				component.setValue(this.settings.defPopoverConfig.enableDefinitionLink);
				component.onChange(async val => {
					this.settings.defPopoverConfig.enableDefinitionLink = val;
					await this.saveCallback();
				});
			});

		new Setting(containerEl)
			.setName(t("Background colour"))
			.setDesc(t("Customise the background colour of the definition popover"))
			.addExtraButton(component => {
				component.setIcon("rotate-ccw");
				component.setTooltip(t("Reset to default colour set by theme"));
				component.onClick(async () => {
					this.settings.defPopoverConfig.backgroundColour = undefined;
					await this.saveCallback();
					this.display();
				});
			})
			.addColorPicker(component => {
				if (this.settings.defPopoverConfig.backgroundColour) {
					component.setValue(this.settings.defPopoverConfig.backgroundColour);
				}
				component.onChange(async val => {
					this.settings.defPopoverConfig.backgroundColour = val;
					await this.saveCallback();
				})
			});

		new Setting(containerEl)
			.setHeading()
			.setName(t("AI integration settings"));




		new Setting(containerEl)
			.setName(t("API provider"))
			.setDesc(t("Choose your AI API provider"))
			.addDropdown(component => {
				component.addOption('openai', 'OpenAI');
				component.addOption('gemini', 'Google Gemini');
				component.addOption('ollama', t('Local Ollama'));
				component.addOption('zhipu', 'Zhipu AI');
				component.addOption('custom', t('Custom provider'));
				component.setValue(this.settings.aiConfig?.currentProvider || 'openai');
				component.onChange(async value => {
					if (!this.settings.aiConfig) {
						this.settings.aiConfig = {
							enabled: true,
							currentProvider: 'openai',
							customPrompt: DEFAULT_DEFINITION_PROMPT,
							customAliasPrompt: DEFAULT_ALIAS_PROMPT,
							providers: {}
						};
					}

					// 确保providers对象存在
					if (!this.settings.aiConfig.providers) {
						this.settings.aiConfig.providers = {};
					}

					// 为新选择的提供商初始化默认配置（如果不存在）
					if (!this.settings.aiConfig.providers[value as keyof typeof this.settings.aiConfig.providers]) {
						const defaultConfigs = {
							openai: { apiKey: '', model: 'gpt-3.5-turbo', baseUrl: '' },
							gemini: { apiKey: '', model: 'gemini-pro', baseUrl: '' },
							ollama: { apiKey: '', model: 'llama3.2', baseUrl: 'http://localhost:11434' },
							zhipu: { apiKey: '', model: 'glm-4', baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions' },
							custom: { apiKey: '', model: '', baseUrl: '' },
						};
						this.settings.aiConfig.providers[value as keyof typeof this.settings.aiConfig.providers] =
							defaultConfigs[value as keyof typeof defaultConfigs];
					}

					// 切换当前提供商
					this.settings.aiConfig.currentProvider = value;

					await this.saveCallback();
					this.display();
				});
			});

		const currentProvider = this.settings.aiConfig?.currentProvider || 'openai';
		const currentProviderConfig = this.settings.aiConfig?.providers?.[currentProvider as keyof typeof this.settings.aiConfig.providers];

		if (currentProvider === 'custom') {
			new Setting(containerEl)
				.setName(t("Base URL"))
				.setDesc(t("Custom provider base URL description"))
				.addText(component => {
					component.setPlaceholder("https://openrouter.ai/api");
					component.setValue(currentProviderConfig?.baseUrl || '');
					component.onChange(async value => {
						if (!this.settings.aiConfig) {
							this.settings.aiConfig = {
								enabled: true,
								currentProvider: 'custom',
								providers: {}
							};
						}
						if (!this.settings.aiConfig.providers) {
							this.settings.aiConfig.providers = {};
						}
						if (!this.settings.aiConfig.providers.custom) {
							this.settings.aiConfig.providers.custom = { apiKey: '', model: '', baseUrl: '' };
						}
						this.settings.aiConfig.providers.custom.baseUrl = value;
						await this.saveCallback();
					});
				});
		} else if (currentProvider === 'ollama') {
			new Setting(containerEl)
				.setName(t("Ollama URL"))
				.setDesc(t("Ollama URL description"))
				.addText(component => {
					component.setPlaceholder("http://localhost:11434");
					component.setValue(currentProviderConfig?.baseUrl || 'http://localhost:11434');
					component.onChange(async value => {
						if (!this.settings.aiConfig) {
							this.settings.aiConfig = {
								enabled: true,
								currentProvider: 'ollama',
								providers: {}
							};
						}
						if (!this.settings.aiConfig.providers) {
							this.settings.aiConfig.providers = {};
						}
						if (!this.settings.aiConfig.providers.ollama) {
							this.settings.aiConfig.providers.ollama = { apiKey: '', model: 'llama3.2', baseUrl: 'http://localhost:11434' };
						}
						this.settings.aiConfig.providers.ollama.baseUrl = value;
						await this.saveCallback();
					});
				});
		}

		new Setting(containerEl)
			.setName(t("AI model"))
			.setDesc(t("Choose the AI model to use for definition generation"))
			.addText(component => {
				let placeholder: string;
				if (currentProvider === 'openai') {
					placeholder = "gpt-3.5-turbo, gpt-4, gpt-4-turbo-preview";
				} else if (currentProvider === 'gemini') {
					placeholder = "gemini-pro, gemini-pro-vision";
				} else if (currentProvider === 'ollama') {
					placeholder = "llama3.2, qwen2.5, mistral";
				} else if (currentProvider === 'zhipu') {
					placeholder = "glm-4, glm-4-plus, glm-4-flash";
				} else {
					placeholder = "e.g., anthropic/claude-3-haiku, meta-llama/llama-2-70b-chat";
				}

				component.setPlaceholder(placeholder);
				component.setValue(currentProviderConfig?.model || '');
				component.onChange(async value => {
					if (!this.settings.aiConfig) {
						this.settings.aiConfig = {
							enabled: true,
							currentProvider: currentProvider,
							providers: {}
						};
					}
					if (!this.settings.aiConfig.providers) {
						this.settings.aiConfig.providers = {};
					}
					const providers = this.settings.aiConfig.providers;
					if (!providers[currentProvider as keyof typeof providers]) {
						providers[currentProvider as keyof typeof providers] = {
							apiKey: '', model: '', baseUrl: ''
						};
					}
					providers[currentProvider as keyof typeof providers]!.model = value;
					await this.saveCallback();
				});
			});

		if (currentProvider !== 'ollama') {
			new Setting(containerEl)
				.setName(t("API key"))
				.setDesc(
					currentProvider === 'custom'
						? t("Your API key for the custom provider")
						: currentProvider === 'gemini'
							? t("Your Google AI Studio API key for Gemini models")
							: currentProvider === 'zhipu'
								? t("Your Zhipu AI API key (BigModel)")
								: t("Your OpenAI API key for AI definition generation")
				)
				.addText(component => {
					let placeholder: string;
					if (currentProvider === 'custom') {
						placeholder = "Your custom API key";
					} else if (currentProvider === 'gemini') {
						placeholder = "AIzaSy...";
					} else if (currentProvider === 'zhipu') {
						placeholder = "ce5...";
					} else {
						placeholder = "...";
					}
					component.setPlaceholder(placeholder);
					component.setValue(currentProviderConfig?.apiKey || '');
					component.inputEl.type = 'password';
					component.onChange(async value => {
						if (!this.settings.aiConfig) {
							this.settings.aiConfig = {
								enabled: true,
								currentProvider: currentProvider,
								providers: {}
							};
						}
						if (!this.settings.aiConfig.providers) {
							this.settings.aiConfig.providers = {};
						}
						const providers = this.settings.aiConfig.providers;
						if (!providers[currentProvider as keyof typeof providers]) {
							providers[currentProvider as keyof typeof providers] = {
								apiKey: '', model: '', baseUrl: ''
							};
						}
						providers[currentProvider as keyof typeof providers]!.apiKey = value;
						await this.saveCallback();
					});
				});
		}

		// 添加连通性测试按钮
		new Setting(containerEl)
			.setName(t("Test"))
			.setDesc(t("Test the connection to your AI provider"))
			.addButton(component => {
				component.setButtonText(t("Test"));
				component.onClick(async () => {
					await this.testConnection();
				});
			});



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
						this.settings.aiConfig?.customPrompt || DEFAULT_DEFINITION_PROMPT,
						this.settings.aiConfig?.customAliasPrompt || DEFAULT_ALIAS_PROMPT,
						async (newPrompt, newAliasPrompt) => {
							if (!this.settings.aiConfig) {
								this.settings.aiConfig = {
									enabled: true,
									currentProvider: 'openai',
									customPrompt: DEFAULT_DEFINITION_PROMPT,
									customAliasPrompt: DEFAULT_ALIAS_PROMPT,
									providers: {}
								};
							}
							this.settings.aiConfig.customPrompt = newPrompt;
							this.settings.aiConfig.customAliasPrompt = newAliasPrompt;
							await this.saveCallback();
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

	private normalizeBaseUrl(url: string): string {
		url = url.trim();
		url = url.replace(/\/v1\/?$/, "");   // 去掉末尾 /v1
		url = url.replace(/\/+$/, "");       // 去掉多余斜杠
		if (!/^https?:\/\//i.test(url)) {
			url = "https://" + url;
		}
		return url;
	}

	private async testConnection() {
		if (!this.settings.aiConfig) {
			new Notice(t("Please configure AI settings first"));
			return;
		}

		const provider = this.settings.aiConfig.currentProvider || "openai";
		const providerConfig = this.settings.aiConfig.providers?.[
			provider as keyof typeof this.settings.aiConfig.providers
		];

		const apiKey = providerConfig?.apiKey;
		let baseUrl = providerConfig?.baseUrl;
		const model = providerConfig?.model;

		if (!provider || !model) {
			new Notice(t("Please configure an AI provider and model first"));
			return;
		}

		if (provider !== "ollama" && !apiKey) {
			new Notice(t("Please configure an API key first"));
			return;
		}

		const notice = new Notice(t("Testing connection..."), 0);

		try {
			let apiUrl: string;
			let headers: Record<string, string>;
			let requestBody: any;

			if (provider === "openai") {
				apiUrl = "https://api.openai.com/v1/chat/completions";
				headers = {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				};
				requestBody = {
					model: model,
					messages: [{ role: "user", content: "test" }],
					max_tokens: 10,
				};
			} else if (provider === "gemini") {
				apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
				headers = {
					"Content-Type": "application/json",
				};
				requestBody = {
					contents: [{ parts: [{ text: "test" }] }],
					generationConfig: { maxOutputTokens: 10 },
				};
			} else if (provider === "ollama") {
				baseUrl = this.normalizeBaseUrl(baseUrl || "");
				apiUrl = `${baseUrl}/api/generate`;
				headers = { "Content-Type": "application/json" };
				requestBody = {
					model: model,
					prompt: "test",
					stream: false,
				};
			} else if (provider === "custom") {
				baseUrl = this.normalizeBaseUrl(baseUrl || "");
				if (baseUrl.endsWith("/chat/completions")) {
					apiUrl = baseUrl;
				} else {
					apiUrl = `${baseUrl}/v1/chat/completions`;
				}
				headers = {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				};
				requestBody = {
					model: model,
					messages: [{ role: "user", content: "test" }],
					max_tokens: 10,
				};
			} else if (provider === "zhipu") {
				apiUrl = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
				headers = {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				};
				requestBody = {
					model: model,
					messages: [{ role: "user", content: "test" }],
					max_tokens: 10,
				};
			} else {
				throw new Error(t("Unsupported provider"));
			}

			const response = await requestUrl({
				url: apiUrl,
				method: "POST",
				headers: headers,
				body: JSON.stringify(requestBody),
			});

			const data = response.json;
			console.log('Test Connection Response:', data);

			if (response.status !== 200) {
				throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
			}

			// 验证响应格式
			let validContent = false;
			if (provider === 'openai' || provider === 'custom') {
				// 只要有 choices 数组，即使 content 为空(例如因为 max_tokens 限制)，也说明连接和协议是通的
				if (Array.isArray(data?.choices) && data.choices.length > 0) validContent = true;
			} else if (provider === 'gemini') {
				if (Array.isArray(data?.candidates) && data.candidates.length > 0) validContent = true;
			} else if (provider === 'ollama') {
				// Ollama 既然返回了 200，且 data 存在，通常 response 字段也会有（可能是空串）
				if (data !== undefined) validContent = true;
			} else if (provider === 'zhipu') {
				if (Array.isArray(data?.choices) && data.choices.length > 0) validContent = true;
			}

			if (validContent) {
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
		const modal = new Modal(this.app);
		const target = t(type === 'folder' ? "Folder" : "File");
		const title = t("{{target}} prompt mapping", { target });
		modal.setTitle(title);

		const content = modal.contentEl;

		// 获取当前映射
		let currentMap: Record<string, string>;
		let currentAliasMap: Record<string, string>;
		if (type === 'folder') {
			currentMap = this.settings.aiConfig?.folderPromptMap || {};
			currentAliasMap = this.settings.aiConfig?.folderAliasPromptMap || {};
		} else {
			currentMap = this.settings.aiConfig?.filePromptMap || {};
			currentAliasMap = this.settings.aiConfig?.fileAliasPromptMap || {};
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
		const modal = new Modal(this.app);
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
					const folders = this.app.vault.getAllLoadedFiles()
						.filter(file => (file as any).children !== undefined) // 只获取文件夹
						.map(folder => folder.path)
						.filter(path => path.length > 0)
						.sort();

					folders.forEach(folderPath => {
						component.addOption(folderPath, folderPath);
					});
				} else {
					// 获取所有markdown文件（简化版本，避免循环依赖）
					const markdownFiles = this.app.vault.getMarkdownFiles();
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
		const modal = new Modal(this.app);
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
		if (!this.settings.aiConfig) {
			this.settings.aiConfig = {
				enabled: true,
				currentProvider: 'openai',
				customPrompt: DEFAULT_DEFINITION_PROMPT,
				customAliasPrompt: DEFAULT_ALIAS_PROMPT,
				providers: {},
				folderPromptMap: {},
				filePromptMap: {},
				folderAliasPromptMap: {},
				fileAliasPromptMap: {}
			};
		}

		if (type === 'folder') {
			this.settings.aiConfig.folderPromptMap = mapping;
			this.settings.aiConfig.folderAliasPromptMap = aliasMapping;
		} else {
			this.settings.aiConfig.filePromptMap = mapping;
			this.settings.aiConfig.fileAliasPromptMap = aliasMapping;
		}

		await this.saveCallback();
	}
}

export function getSettings(): Settings {
	return window.NoteDefinition.settings;
}
