import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, setTooltip, requestUrl } from "obsidian";
import { DefFileType } from "./core/file-type";

// 内置Prompt常量
export const DEFAULT_DEFINITION_PROMPT = '你是一个专业的术语定义助手。请为给定的词语或短语"{word}"提供准确、简洁、专业的定义。应该根据定义的所属类别确定定义内容的风格，推荐使用Markdown语法引用权威来源。请用中文回答，全文使用标准Markdown语法，保持定义简洁明了，不要添加任何无关语句。';

export const DEFAULT_ALIAS_PROMPT = '请为术语"{word}"生成相关的别名。请优先使用维基百科介绍中的别名，包括：\n1. 英文翻译（如果原词是中文）\n2. 中文翻译（如果原词是英文）\n3. 常用别名或又称\n4. 简称或缩写\n\n请直接返回别名列表，每个别名用逗号分隔，不要包含原词本身，不要添加任何解释文字。\n例如：Bubble Sort, 泡式排序, 气泡排序';

// Prompt模板常量
export const DEFINITION_PROMPT_TEMPLATES: Record<string, string> = {
	'default': DEFAULT_DEFINITION_PROMPT,
	'technical': '你是一个技术术语专家。请为技术术语"{word}"提供专业定义，包括：\n1. 核心概念和原理\n2. 技术特征和功能\n3. 应用场景和用途\n4. 相关技术栈或依赖\n请用中文回答，全文使用标准Markdown语法，保持技术准确性，不要添加任何无关语句。',
	'academic': '你是一个学术概念专家。请为学术术语"{word}"提供严谨的定义，包括：\n1. 学科背景和理论基础\n2. 核心概念和内涵\n3. 学术意义和价值\n4. 相关理论或研究\n请用中文回答，全文使用标准Markdown语法，保持学术严谨性，不要添加任何无关语句。',
	'business': '你是一个商业术语专家。请为商业术语"{word}"提供实用的定义，包括：\n1. 商业含义和价值\n2. 应用场景和实践\n3. 对企业的影响\n4. 相关商业概念\n请用中文回答，全文使用标准Markdown语法，注重实用性，不要添加任何无关语句。',
	'medical': '你是一个医学术语专家。请为医学术语"{word}"提供准确的定义，包括：\n1. 医学含义和机制\n2. 临床表现或特征\n3. 诊断或治疗相关\n4. 相关医学概念\n请用中文回答，全文使用标准Markdown语法，保持医学准确性，不要添加任何无关语句。'
};

export const ALIAS_PROMPT_TEMPLATES: Record<string, string> = {
	'default': DEFAULT_ALIAS_PROMPT,
	'wikipedia': '请为术语"{word}"生成维基百科风格的别名，包括：\n1. 官方英文名称\n2. 中文译名\n3. 学术名称\n4. 通俗称呼\n5. 历史名称\n\n请直接返回别名列表，用逗号分隔，不包含解释。',
	'multilingual': '请为术语"{word}"生成多语言别名：\n1. 英文名称（如果原词是中文）\n2. 中文名称（如果原词是英文）\n3. 其他常见语言的名称\n4. 国际通用名称\n\n请直接返回别名列表，用逗号分隔。',
	'abbreviation': '请为术语"{word}"生成缩写和简称：\n1. 英文缩写\n2. 中文简称\n3. 行业内常用缩写\n4. 口语化简称\n\n请直接返回别名列表，用逗号分隔。',
	'synonym': '请为术语"{word}"生成同义词和近义词：\n1. 完全同义词\n2. 近义词\n3. 相关概念\n4. 类似术语\n\n请直接返回别名列表，用逗号分隔。'
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
	};
	// Prompt映射功能 - 分别存储定义和别名prompt
	folderPromptMap?: Record<string, string>; // 文件夹路径 -> 定义prompt (for atomic)
	filePromptMap?: Record<string, string>;   // 文件路径 -> 定义prompt (for consolidated)
	folderAliasPromptMap?: Record<string, string>; // 文件夹路径 -> 别名prompt (for atomic)
	fileAliasPromptMap?: Record<string, string>;   // 文件路径 -> 别名prompt (for consolidated)
}

export enum ViewMode {
	Manager = "manager",
	Flashcard = "flashcard",
	Statistics = "browse"
}

export interface FlashcardConfig {
	dailyNewCards: number;
	dailyReviewLimit: number;
	enableSM2Algorithm: boolean;
	studyScope: string[]; // 选择的文件/文件夹路径
}

export interface Settings {
	enableInReadingView: boolean;
	enableSpellcheck: boolean;
	defFolder: string;
	popoverEvent: PopoverEventSettings;
	defFileParseConfig: DefFileParseConfig;
	defPopoverConfig: DefinitionPopoverConfig;
	aiConfig?: AIConfig;
	flashcardConfig?: FlashcardConfig;
	defaultViewMode?: string; // 默认视图模式：'manager', 'flashcard', 'browse'
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
	},
	flashcardConfig: {
		dailyNewCards: 20,
		dailyReviewLimit: 100,
		enableSM2Algorithm: true,
		studyScope: []
	},
	defaultViewMode: 'manager' // 默认为Definition Manager模式
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
			.setName("Enable in Reading View")
			.setDesc("Allow defined phrases and definition popovers to be shown in Reading View")
			.addToggle((component) => {
				component.setValue(this.settings.enableInReadingView);
				component.onChange(async (val) => {
					this.settings.enableInReadingView = val;
					await this.saveCallback();
				});
			});
		new Setting(containerEl)
			.setName("Enable spellcheck for defined words")
			.setDesc("Allow defined words and phrases to be spellchecked")
			.addToggle((component) => {
				component.setValue(this.settings.enableSpellcheck);
				component.onChange(async (val) => {
					this.settings.enableSpellcheck = val;
					await this.saveCallback();
				});
			});

		new Setting(containerEl)
			.setName("Definitions folder")
			.setDesc("Files within this folder will be parsed to register definitions")
			.addText((component) => {
				component.setValue(this.settings.defFolder);
				component.setPlaceholder(DEFAULT_DEF_FOLDER);
				component.setDisabled(true)
				setTooltip(component.inputEl,
					"In the file explorer, right-click on the desired folder and click on 'Set definition folder' to change the definition folder",
					{
						delay: 100
					});
			});
		new Setting(containerEl)
			.setName("Definition file format settings")
			.setDesc("Customise parsing rules for definition files")
			.addExtraButton(component => {
				component.onClick(() => {
					const modal = new Modal(this.app);
					modal.setTitle("Definition file format settings")
					new Setting(modal.contentEl)
						.setName("Divider")
						.setHeading()
					new Setting(modal.contentEl)
						.setName("Dash")
						.setDesc("Use triple dash (---) as divider")
						.addToggle((component) => {
							component.setValue(this.settings.defFileParseConfig.divider.dash);
							component.onChange(async value => {
								if (!value && !this.settings.defFileParseConfig.divider.underscore) {
									new Notice("At least one divider must be chosen", 2000);
									component.setValue(this.settings.defFileParseConfig.divider.dash);
									return;
								}
								this.settings.defFileParseConfig.divider.dash = value;
								await this.saveCallback();
							});
						});
					new Setting(modal.contentEl)
						.setName("Underscore")
						.setDesc("Use triple underscore (___) as divider")
						.addToggle((component) => {
							component.setValue(this.settings.defFileParseConfig.divider.underscore);
							component.onChange(async value => {
								if (!value && !this.settings.defFileParseConfig.divider.dash) {
									new Notice("At least one divider must be chosen", 2000);
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
			.setName("Default definition file type")
			.setDesc("When the 'def-type' frontmatter is not specified, the definition file will be treated as this configured default file type.")
			.addDropdown(component => {
				component.addOption(DefFileType.Consolidated, "consolidated");
				component.addOption(DefFileType.Atomic, "atomic");
				component.setValue(this.settings.defFileParseConfig.defaultFileType ?? DefFileType.Consolidated);
				component.onChange(async val => {
					this.settings.defFileParseConfig.defaultFileType = val as DefFileType;
					await this.saveCallback();
				});
			});

		new Setting(containerEl)
			.setName("Automatically detect plurals -- English only")
			.setDesc("Attempt to automatically generate aliases for words using English pluralisation rules")
			.addToggle((component) => {
				component.setValue(this.settings.defFileParseConfig.autoPlurals);
				component.onChange(async (val) => {
					this.settings.defFileParseConfig.autoPlurals = val;
					await this.saveCallback();
				});
			});

		new Setting(containerEl)
			.setName("Default view mode for Definition Manager")
			.setDesc("Choose which mode to activate by default when opening the Definition Manager view")
			.addDropdown(component => {
				component.addOption('manager', 'Definition Manager');
				component.addOption('flashcard', 'Flashcard Study');
				component.addOption('browse', 'Browse Mode');
				component.setValue(this.settings.defaultViewMode || 'manager');
				component.onChange(async value => {
					this.settings.defaultViewMode = value;
					await this.saveCallback();
				});
			});

		new Setting(containerEl)
			.setHeading()
			.setName("Definition Popover Settings");

		new Setting(containerEl)
			.setName("Definition popover display event")
			.setDesc("Choose the trigger event for displaying the definition popover")
			.addDropdown((component) => {
				component.addOption(PopoverEventSettings.Hover, "Hover");
				component.addOption(PopoverEventSettings.Click, "Click");
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
				.setName("Definition popover dismiss event")
				.setDesc("Configure the manner in which you would like to close/dismiss the definition popover.")
				.addDropdown(component => {
					component.addOption(PopoverDismissType.Click, "Click");
					component.addOption(PopoverDismissType.MouseExit, "Mouse exit")
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
			.setName("Display aliases")
			.setDesc("Display the list of aliases configured for the definition")
			.addToggle(component => {
				component.setValue(this.settings.defPopoverConfig.displayAliases);
				component.onChange(async value => {
					this.settings.defPopoverConfig.displayAliases = value;
					await this.saveCallback();
				});
			});


		new Setting(containerEl)
			.setName("Display definition source file")
			.setDesc("Display the title of the definition's source file")
			.addToggle(component => {
				component.setValue(this.settings.defPopoverConfig.displayDefFileName);
				component.onChange(async value => {
					this.settings.defPopoverConfig.displayDefFileName = value;
					await this.saveCallback();
				});
			});

		new Setting(containerEl)
			.setName("Custom popover size")
			.setDesc("Customise the maximum popover size. This is not recommended as it prevents dynamic sizing of the popover based on your viewport.")
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
				.setName("Popover width (px)")
				.setDesc("Maximum width of the definition popover")
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
				.setName("Popover height (px)")
				.setDesc("Maximum height of the definition popover")
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
			.setName("Enable definition links")
			.setDesc("Definitions within popovers will be marked and can be clicked to go to definition.")
			.addToggle(component => {
				component.setValue(this.settings.defPopoverConfig.enableDefinitionLink);
				component.onChange(async val => {
					this.settings.defPopoverConfig.enableDefinitionLink = val;
					await this.saveCallback();
				});
			});

		new Setting(containerEl)
			.setName("Background colour")
			.setDesc("Customise the background colour of the definition popover")
			.addExtraButton(component => {
				component.setIcon("rotate-ccw");
				component.setTooltip("Reset to default colour set by theme");
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
			.setName("AI Integration Settings");




		new Setting(containerEl)
			.setName("API Provider")
			.setDesc("Choose your AI API provider")
			.addDropdown(component => {
				component.addOption('openai', 'OpenAI');
				component.addOption('gemini', 'Google Gemini');
				component.addOption('ollama', 'Local Ollama');
				component.addOption('custom', 'Custom Provider');
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
							custom: { apiKey: '', model: '', baseUrl: '' }
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
				.setName("Base URL")
				.setDesc("The base URL for your custom API provider (e.g., https://openrouter.ai/api)")
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
				.setName("Ollama URL")
				.setDesc("The URL where Ollama is running (default: http://localhost:11434)")
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
			.setName("AI Model")
			.setDesc("Choose the AI model to use for definition generation")
			.addText(component => {
				let placeholder: string;
				if (currentProvider === 'openai') {
					placeholder = "gpt-3.5-turbo, gpt-4, gpt-4-turbo-preview";
				} else if (currentProvider === 'gemini') {
					placeholder = "gemini-pro, gemini-pro-vision";
				} else if (currentProvider === 'ollama') {
					placeholder = "llama3.2, qwen2.5, mistral";
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
				.setName("API Key")
				.setDesc(currentProvider === 'custom'
					? "Your API key for the custom provider"
					: currentProvider === 'gemini'
						? "Your Google AI Studio API key for Gemini models"
						: "Your OpenAI API key for AI definition generation")
				.addText(component => {
					let placeholder: string;
					if (currentProvider === 'custom') {
						placeholder = "Your custom API key";
					} else if (currentProvider === 'gemini') {
						placeholder = "AIzaSy...";
					} else {
						placeholder = "sk-...";
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
			.setName("Test")
			.setDesc("Test the connection to your AI provider")
			.addButton(component => {
				component.setButtonText("Test");
				component.onClick(async () => {
					await this.testConnection();
				});
			});



		// 添加Prompt映射设置
		new Setting(containerEl)
			.setHeading()
			.setName("Prompt Settings");

		new Setting(containerEl)
			.setName("Default Prompts")
			.setDesc("Configure default prompts for definition and alias generation")
			.addButton(component => {
				component.setButtonText("Manage");
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
			.setName("Folder Prompt Mapping (Atomic)")
			.setDesc("Set specific prompts for different folders when creating atomic definitions")
			.addButton(component => {
				component.setButtonText("Manage");
				component.onClick(() => {
					this.showPromptMappingModal('folder');
				});
			});

		new Setting(containerEl)
			.setName("File Prompt Mapping (Consolidated)")
			.setDesc("Set specific prompts for different consolidated definition files")
			.addButton(component => {
				component.setButtonText("Manage");
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
			new Notice("请先配置AI设置");
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
			new Notice("请先配置AI提供商和模型");
			return;
		}

		if (provider !== "ollama" && !apiKey) {
			new Notice("请先配置API Key");
			return;
		}

		const notice = new Notice("正在测试连接...", 0);

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
				apiUrl = `${baseUrl}/v1/chat/completions`;
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
				throw new Error("不支持的提供商");
			}

			const response = await requestUrl({
				url: apiUrl,
				method: "POST",
				headers: headers,
				body: JSON.stringify(requestBody),
			});

					if (response.status === 200) {
				notice.hide();
				new Notice("连接测试成功", 2000);
			} else {
				throw new Error(`HTTP ${response.status}`);
			}
		} catch (error: any) {
			notice.hide();
			console.error("连接测试失败:", error);
			new Notice(`连接测试失败: ${error.message}`, 5000);
		}
	}

	private showPromptMappingModal(type: 'folder' | 'file') {
		const modal = new Modal(this.app);
		const title = `${type === 'folder' ? 'Folder' : 'File'} Prompt Mapping`;
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

				const editButton = buttonGroup.createEl("button", { text: "Edit" });
				editButton.style.fontSize = "12px";
				editButton.onclick = () => {
					this.showPromptEditModal(path, prompt, aliasPrompt, (newPrompt, newAliasPrompt) => {
						currentMap[path] = newPrompt;
						currentAliasMap[path] = newAliasPrompt;
						this.savePromptMapping(type, currentMap, currentAliasMap);
						refreshMappingList();
					});
				};

				const deleteButton = buttonGroup.createEl("button", { text: "Delete" });
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

				const defPromptLabel = defPromptContainer.createDiv({ text: "定义Prompt:" });
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

				const aliasPromptLabel = aliasPromptContainer.createDiv({ text: "别名Prompt:" });
				aliasPromptLabel.style.fontSize = "12px";
				aliasPromptLabel.style.fontWeight = "bold";
				aliasPromptLabel.style.color = "var(--text-muted)";
				aliasPromptLabel.style.marginBottom = "3px";

				const aliasPromptSpan = aliasPromptContainer.createDiv({ text: aliasPrompt ? (aliasPrompt.substring(0, 80) + (aliasPrompt.length > 80 ? "..." : "")) : "未设置" });
				aliasPromptSpan.style.fontSize = "12px";
				aliasPromptSpan.style.color = aliasPrompt ? "var(--text-normal)" : "var(--text-muted)";
				aliasPromptSpan.style.fontFamily = "monospace";
				aliasPromptSpan.style.backgroundColor = "var(--background-secondary)";
				aliasPromptSpan.style.padding = "5px";
				aliasPromptSpan.style.borderRadius = "3px";
			});

			if (Object.keys(currentMap).length === 0) {
				const emptyMessage = mappingContainer.createDiv({ text: "No mappings configured" });
				emptyMessage.style.textAlign = "center";
				emptyMessage.style.color = "var(--text-muted)";
				emptyMessage.style.padding = "20px";
			}
		};

		refreshMappingList();

		// 添加新映射按钮
		const addButton = content.createEl("button", { text: `Add ${type === 'folder' ? 'Folder' : 'File'} Mapping` });
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
		modal.setTitle(`Add ${type === 'folder' ? 'Folder' : 'File'} Mapping`);

		const content = modal.contentEl;

		// 路径选择
		new Setting(content)
			.setName(type === 'folder' ? 'Folder Path' : 'File Path')
			.setDesc(`Select the ${type} to map`)
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
			.setName('定义生成Prompt')
			.setDesc('Enter the custom prompt for definition generation')
			.addTextArea(component => {
				promptTextArea = component.inputEl;
				component.inputEl.rows = 6;
				component.inputEl.style.width = '100%';
				component.inputEl.style.resize = 'vertical';
			});

		// 添加定义prompt模板选择
		new Setting(content)
			.setName('定义Prompt模板')
			.setDesc('选择常用的定义prompt模板')
			.addDropdown(component => {
				component.addOption('', '选择模板...');
				component.addOption('default', '默认通用模板');
				component.addOption('technical', '技术术语模板');
				component.addOption('academic', '学术概念模板');
				component.addOption('business', '商业术语模板');
				component.addOption('medical', '医学术语模板');
				component.onChange(value => {
					if (value && promptTextArea) {
						promptTextArea.value = DEFINITION_PROMPT_TEMPLATES[value] || '';
					}
				});
			});

		// 别名Prompt输入
		let aliasPromptTextArea: HTMLTextAreaElement;
		new Setting(content)
			.setName('别名生成Prompt')
			.setDesc('Enter the custom prompt for alias generation')
			.addTextArea(component => {
				aliasPromptTextArea = component.inputEl;
				component.inputEl.rows = 6;
				component.inputEl.style.width = '100%';
				component.inputEl.style.resize = 'vertical';
			});

		// 添加别名prompt模板选择
		new Setting(content)
			.setName('别名Prompt模板')
			.setDesc('选择常用的别名prompt模板')
			.addDropdown(component => {
				component.addOption('', '选择模板...');
				component.addOption('default', '默认通用模板');
				component.addOption('wikipedia', '维基百科风格');
				component.addOption('multilingual', '多语言别名');
				component.addOption('abbreviation', '缩写重点');
				component.addOption('synonym', '同义词重点');
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

		const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
		cancelButton.onclick = () => modal.close();

		const addButton = buttonContainer.createEl("button", { text: "Add" });
		addButton.addClass("mod-cta");
		addButton.onclick = () => {
			const pathDropdown = content.querySelector('select') as HTMLSelectElement;
			const path = pathDropdown.value;
			const prompt = promptTextArea.value.trim();
			const aliasPrompt = aliasPromptTextArea.value.trim();

			if (!path || !prompt) {
				new Notice("Please select a path and enter a definition prompt");
				return;
			}

			if (!aliasPrompt) {
				new Notice("Please enter an alias prompt");
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
		modal.setTitle(isDefault ? 'Edit Default Prompts' : `Edit Prompt for ${path}`);

		const content = modal.contentEl;

		let promptTextArea: HTMLTextAreaElement;
		new Setting(content)
			.setName('Definition Prompt')
			.setDesc(isDefault ? 'Default prompt for definition generation. Use {word} as placeholder.' : 'Edit the definition prompt for this mapping')
			.addTextArea(component => {
				promptTextArea = component.inputEl;
				component.setValue(currentPrompt);
				component.inputEl.rows = 6;
				component.inputEl.style.width = '100%';
				component.inputEl.style.resize = 'vertical';
			});


		let aliasPromptTextArea: HTMLTextAreaElement;
		new Setting(content)
			.setName('Alias Prompt')
			.setDesc(isDefault ? 'Default prompt for alias generation. Use {word} as placeholder.' : 'Edit the alias prompt for this mapping')
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
			const resetButton = leftButtons.createEl("button", { text: "Reset to System Default" });
			resetButton.onclick = () => {
				promptTextArea.value = DEFAULT_DEFINITION_PROMPT;
				aliasPromptTextArea.value = DEFAULT_ALIAS_PROMPT;
			};
		}

		// 右侧按钮组
		const rightButtons = buttonContainer.createDiv();
		rightButtons.style.display = "flex";
		rightButtons.style.gap = "10px";

		const cancelButton = rightButtons.createEl("button", { text: "Cancel" });
		cancelButton.onclick = () => modal.close();

		const saveButton = rightButtons.createEl("button", { text: "Save" });
		saveButton.addClass("mod-cta");
		saveButton.onclick = () => {
			const newPrompt = promptTextArea.value.trim();
			const newAliasPrompt = aliasPromptTextArea.value.trim();

			if (!newPrompt) {
				new Notice("Please enter a definition prompt");
				return;
			}

			if (!newAliasPrompt) {
				new Notice("Please enter an alias prompt");
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
