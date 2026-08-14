import { App, Notice, Setting } from "obsidian";
import { t } from "../i18n";
import { getEcdictStore } from "./ecdict-store";
import { DEFINITION_SOURCES } from "./registry";
import {
	DefinitionSourceId,
	DefinitionSourcesConfig,
	EcdictVocabularyTag,
} from "./types";

export interface DefinitionSourcesSettingsContext {
	app: App;
	getConfig(): DefinitionSourcesConfig;
	saveCallback(): Promise<void>;
}

export class DefinitionSourcesSettingsRenderer {
	constructor(private context: DefinitionSourcesSettingsContext) {}

	render(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setHeading()
			.setName(t("Definition source settings"))
			.setDesc(t("Configure external sources that will provide definition candidates, aliases, senses, and examples."));

		new Setting(containerEl)
			.setName(t("Preferred result language"))
			.setDesc(t("Choose the preferred language for definition lookup results"))
			.addDropdown(dropdown => {
				dropdown.addOption("auto", t("Follow Obsidian language"));
				dropdown.addOption("zh", t("Chinese"));
				dropdown.addOption("en", t("English"));
				dropdown.setValue(this.context.getConfig().preferredLanguage);
				dropdown.onChange(async value => {
					if (value === "auto" || value === "zh" || value === "en") {
						this.context.getConfig().preferredLanguage = value;
						await this.context.saveCallback();
					}
				});
			});

		new Setting(containerEl)
			.setHeading()
			.setName(t("Definition sources"))
			.setDesc(t("Select the sources used to look up definition candidates in the add-definition dialog."));

		for (const source of DEFINITION_SOURCES) {
			const setting = new Setting(containerEl)
				.setName(source.name)
				.setDesc(`${this.getSourceDescription(source.id)} · ${source.license}`);

			setting.nameEl.createSpan({
				text: t("Available"),
				cls: "definition-source-status",
			});

			if (source.id === "ecdict") {
				this.addEcdictDownloadControl(setting);
			}

			setting.addToggle(toggle => {
				toggle.setTooltip(t("Enable definition source"));
				toggle.setValue(this.context.getConfig().sources[source.id].enabled);
				toggle.onChange(async enabled => {
					this.context.getConfig().sources[source.id].enabled = enabled;
					await this.context.saveCallback();
				});
			});

			if (source.id === "ecdict") {
				this.addEcdictContentOptions(containerEl);
			}
		}
	}

	private addEcdictContentOptions(containerEl: HTMLElement): void {
		const englishSetting = new Setting(containerEl)
			.setName(t("Include English definitions"))
			.setDesc(t("Add ECDICT English definitions after the Chinese meanings."))
			.addToggle(toggle => {
				toggle.setValue(this.context.getConfig().sources.ecdict.includeEnglishDefinition);
				toggle.onChange(async enabled => {
					this.context.getConfig().sources.ecdict.includeEnglishDefinition = enabled;
					await this.context.saveCallback();
				});
			});
		englishSetting.settingEl.addClass("definition-source-subsetting");

		const tags: Array<{ key: EcdictVocabularyTag; name: string }> = [
			{ key: "oxford3000", name: t("Oxford 3000") },
			{ key: "zk", name: t("Junior high school exam") },
			{ key: "gk", name: t("Gaokao") },
			{ key: "cet4", name: "CET-4" },
			{ key: "cet6", name: "CET-6" },
			{ key: "ky", name: t("Postgraduate entrance exam") },
			{ key: "gre", name: "GRE" },
			{ key: "toefl", name: "TOEFL" },
			{ key: "ielts", name: "IELTS" },
		];
		const tagSettings: Setting[] = [];
		const setTagSettingsVisible = (visible: boolean): void => {
			for (const setting of tagSettings) {
				if (visible) setting.settingEl.show();
				else setting.settingEl.hide();
			}
		};

		const vocabularyHeading = new Setting(containerEl)
			.setName(t("Vocabulary tags"))
			.setDesc(t("Choose which Oxford and exam tags to add to generated definitions."))
			.addToggle(toggle => {
				toggle.setTooltip(t("Enable vocabulary tags"));
				toggle.setValue(this.context.getConfig().sources.ecdict.vocabularyTagsEnabled);
				toggle.onChange(async enabled => {
					this.context.getConfig().sources.ecdict.vocabularyTagsEnabled = enabled;
					setTagSettingsVisible(enabled);
					await this.context.saveCallback();
				});
			});
		vocabularyHeading.settingEl.addClass("definition-source-subsetting");

		for (const tag of tags) {
			const setting = new Setting(containerEl)
				.setName(tag.name)
				.addToggle(toggle => {
					toggle.setValue(this.context.getConfig().sources.ecdict.vocabularyTags[tag.key]);
					toggle.onChange(async enabled => {
						this.context.getConfig().sources.ecdict.vocabularyTags[tag.key] = enabled;
						await this.context.saveCallback();
					});
				});
			setting.settingEl.addClass("definition-source-subsetting", "definition-source-tag-setting");
			tagSettings.push(setting);
		}
		setTagSettingsVisible(this.context.getConfig().sources.ecdict.vocabularyTagsEnabled);
	}

	private getSourceDescription(sourceId: DefinitionSourceId): string {
		if (sourceId === "ecdict") {
			return t("English-Chinese dictionary with phonetics, parts of speech, and word forms");
		}
		if (sourceId === "wikidata") {
			return t("Search concepts and retrieve Chinese and English aliases");
		}
		return t("Retrieve definitions, parts of speech, and examples");
	}

	private addEcdictDownloadControl(setting: Setting): void {
		const store = getEcdictStore(this.context.app);
		const statusEl = setting.descEl.createDiv({
			cls: "definition-source-download-status",
			text: t("ECDICT downloads about 63 MB once and is then queried locally."),
		});

		setting.addButton(button => {
			let installed = false;
			const refresh = async () => {
				const status = await store.getStatus();
				installed = status.installed;
				button.setButtonText(status.installed ? t("Rebuild local index") : t("Download dictionary"));
				if (status.installed) {
					statusEl.setText(t("Installed locally ({{count}} entries)", {
						count: status.entryCount || 0,
					}));
				}
			};

			button.onClick(async () => {
				button.setDisabled(true);
				button.setButtonText(t("Downloading..."));
				const unsubscribe = store.onProgress(progress => {
					const percent = Math.min(100, Math.round(
						progress.processedBytes / progress.totalBytes * 100,
					));
					statusEl.setText(t("Downloading and indexing ECDICT... {{percent}}%", { percent }));
				});
				try {
					await store.install(installed);
					new Notice(t("ECDICT is ready"));
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					statusEl.setText(t("ECDICT installation failed: {{error}}", { error: message }));
					new Notice(t("ECDICT installation failed: {{error}}", { error: message }));
				} finally {
					unsubscribe();
					button.setDisabled(false);
					await refresh();
				}
			});

			void refresh();
		});
	}
}
