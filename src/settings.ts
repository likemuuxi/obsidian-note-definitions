import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, setTooltip } from "obsidian";
import { DefFileType } from "./core/file-type";
import { t } from "./i18n";
import { AISettingsRenderer } from "./ai/settings-ui";

// Re-export AI modules for backward-compatible imports from other modules
export type { AIConfig, ProviderEntry, ProviderConfig } from "./ai/types";
export type { APIProtocol, ProtocolAdapter } from "./ai/providers";
export {
	DEFAULT_DEFINITION_PROMPT, DEFAULT_ALIAS_PROMPT,
	DEFINITION_PROMPT_TEMPLATES, ALIAS_PROMPT_TEMPLATES,
} from "./ai/types";
export {
	PROTOCOL_TYPES, PROTOCOLS, getProtocol, protocolLabel
} from "./ai/providers";

import { AIConfig, DEFAULT_DEFINITION_PROMPT, DEFAULT_ALIAS_PROMPT } from "./ai/types";

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
		activeProviderId: undefined,
		providers: [],
		customPrompt: DEFAULT_DEFINITION_PROMPT,
		customAliasPrompt: DEFAULT_ALIAS_PROMPT,
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

	activeTab: 'general' | 'ai' = 'general';

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		this.renderTabBar(containerEl);

		const contentEl = containerEl.createDiv();
		if (this.activeTab === 'ai') {
			this.renderAISettings(contentEl);
		} else {
			this.renderGeneralSettings(contentEl);
		}
	}

	private renderTabBar(containerEl: HTMLElement): void {
		const tabBar = containerEl.createDiv();
		tabBar.style.display = 'flex';
		tabBar.style.gap = '4px';
		tabBar.style.borderBottom = '1px solid var(--background-modifier-border)';
		tabBar.style.marginBottom = '24px';

		const createTabButton = (label: string, tab: 'general' | 'ai') => {
			const btn = tabBar.createEl('button', { text: label });
			const isActive = this.activeTab === tab;
			btn.style.padding = '6px 14px';
			btn.style.marginBottom = '-1px';
			btn.style.border = 'none';
			btn.style.borderBottom = isActive ? '2px solid var(--interactive-accent)' : '2px solid transparent';
			btn.style.background = 'transparent';
			btn.style.color = isActive ? 'var(--text-normal)' : 'var(--text-muted)';
			btn.style.fontWeight = isActive ? '600' : 'normal';
			btn.style.cursor = 'pointer';
			btn.style.borderRadius = '0';
			btn.onclick = () => {
				this.activeTab = tab;
				this.display();
			};
		};

		createTabButton(t("General settings"), 'general');
		createTabButton(t("AI & Prompts"), 'ai');
	}

	private renderGeneralSettings(containerEl: HTMLElement): void {
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
	}

	private renderAISettings(containerEl: HTMLElement): void {
		const renderer = new AISettingsRenderer({
			app: this.app,
			getAIConfig: () => {
				if (!this.settings.aiConfig) {
					this.settings.aiConfig = {
						enabled: true,
						providers: [],
						customPrompt: DEFAULT_DEFINITION_PROMPT,
						customAliasPrompt: DEFAULT_ALIAS_PROMPT,
						folderPromptMap: {},
						filePromptMap: {},
						folderAliasPromptMap: {},
						fileAliasPromptMap: {}
					};
				}
				return this.settings.aiConfig;
			},
			saveCallback: this.saveCallback,
			rerender: () => this.display(),
		});
		renderer.render(containerEl);
	}
}

export function getSettings(): Settings {
	return window.NoteDefinition.settings;
}
