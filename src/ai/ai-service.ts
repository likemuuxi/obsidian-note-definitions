import { requestUrl, App } from "obsidian";
import { DEFAULT_DEFINITION_PROMPT, DEFAULT_ALIAS_PROMPT, AIConfig, ProviderEntry } from "./types";
import { getProtocol } from "./providers";
import { t } from "../i18n";

const MAX_TOKENS = 2000;
const MAX_ALIAS_TOKENS = 100;

export class AIService {
	private config: AIConfig;
	private app: App;

	constructor(config: AIConfig, app: App) {
		this.config = config;
		this.app = app;
	}

	get aiConfig(): AIConfig {
		return this.config;
	}

	updateConfig(config: AIConfig) {
		this.config = config;
	}

	/** 返回当前激活的供应商条目（或第一个可用的）。 */
	getActiveProvider(): ProviderEntry | undefined {
		const list = this.config.providers || [];
		if (this.config.activeProviderId) {
			return list.find(p => p.id === this.config.activeProviderId);
		}
		return list[0];
	}

	/** 从 Obsidian SecretStorage 读取该条目关联的 API 密钥。 */
	getApiKey(entry: ProviderEntry): string {
		if (!entry.secretKey) return '';
		return this.app.secretStorage.getSecret(entry.secretKey) ?? '';
	}

	// ────────────── Prompt 映射 ──────────────

	getMappedPrompt(fileType: string, path: string): string {
		let mappedPrompt: string | undefined;
		if (fileType === 'atomic') {
			mappedPrompt = this.config.folderPromptMap?.[path];
		} else if (fileType === 'consolidated') {
			mappedPrompt = this.config.filePromptMap?.[path];
		}
		return mappedPrompt || this.config.customPrompt || DEFAULT_DEFINITION_PROMPT;
	}

	getMappedAliasPrompt(fileType: string, path: string): string {
		let mappedPrompt: string | undefined;
		if (fileType === 'atomic') {
			mappedPrompt = this.config.folderAliasPromptMap?.[path];
		} else if (fileType === 'consolidated') {
			mappedPrompt = this.config.fileAliasPromptMap?.[path];
		}
		return mappedPrompt || this.config.customAliasPrompt || DEFAULT_ALIAS_PROMPT;
	}

	private generatePrompt(word: string, fileType?: string, path?: string): string {
		const customPrompt = (fileType && path)
			? this.getMappedPrompt(fileType, path)
			: this.config.customPrompt || DEFAULT_DEFINITION_PROMPT;

		if (customPrompt.includes('{word}')) {
			return customPrompt.replace(/\{word\}/g, word);
		}
		return `${customPrompt}\n\n${t("Please provide a professional definition for \"{{word}}\".", { word })}`;
	}

	private generateAliasPrompt(word: string, fileType?: string, path?: string): string {
		const customPrompt = (fileType && path)
			? this.getMappedAliasPrompt(fileType, path)
			: this.config.customAliasPrompt || DEFAULT_ALIAS_PROMPT;

		if (customPrompt.includes('{word}')) {
			return customPrompt.replace(/\{word\}/g, word);
		}
		return `${customPrompt}\n\n${t("Please generate relevant aliases for \"{{word}}\".", { word })}`;
	}

	// ────────────── 核心：通过 adapter 统一调用 ──────────────

	/**
	 * 统一的 AI 请求入口。所有供应商差异由 ProviderAdapter 处理。
	 */
	private async callAI(entry: ProviderEntry, prompt: string, maxTokens: number): Promise<string> {
		const adapter = getProtocol(entry.protocol);
		if (!adapter) {
			throw new Error(t("Invalid API provider configuration"));
		}

		const apiKey = this.getApiKey(entry);
		if (adapter.needsApiKey && !apiKey) {
			throw new Error(t("API key is not configured"));
		}

		const { url, headers, body } = adapter.buildRequest(
			entry.model, apiKey, entry.baseUrl, prompt, maxTokens
		);

		const response = await requestUrl({
			url, method: 'POST', headers, body: JSON.stringify(body),
		});

		const data = response.json;
		if (response.status !== 200) {
			throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
		}

		return adapter.parseResponse(data);
	}

	// ────────────── 公开 API ──────────────

	async generateDefinition(word: string, fileType?: string, path?: string): Promise<string> {
		const entry = this.getActiveProvider();
		if (!entry) {
			throw new Error(t("Please configure an AI provider and model first"));
		}
		const prompt = this.generatePrompt(word, fileType, path);
		return this.callAI(entry, prompt, MAX_TOKENS);
	}

	async generateAliases(word: string, fileType?: string, path?: string): Promise<string[]> {
		try {
			const entry = this.getActiveProvider();
			if (!entry) {
				throw new Error(t("Please configure an AI provider and model first"));
			}
			const aliasPrompt = this.generateAliasPrompt(word, fileType, path);
			const aliasText = await this.callAI(entry, aliasPrompt, MAX_ALIAS_TOKENS);

			const aliases = aliasText
				.split(/[,，、\n]/)
				.map(a => a.trim())
				.filter(a => a && a !== word && a.length < 50 && !a.match(/^\d+\./) && !/别名|例如|aliases?|for example|e\.g\.|：/i.test(a))
				.map(a => a.replace(/^["'`。，]+|["'`。，]+$/g, '').trim())
				.filter(a => a.length > 0)
				.slice(0, 5);

			return aliases;
		} catch (error) {
			console.error('AI生成别名失败:', error);
			return [];
		}
	}
}
