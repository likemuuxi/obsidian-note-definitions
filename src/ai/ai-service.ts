import { requestUrl, App } from "obsidian";
import { DEFAULT_DEFINITION_PROMPT, DEFAULT_ALIAS_PROMPT, DEFINITION_SKILL, ALIAS_SKILL, AIConfig, ProviderEntry } from "./types";
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
		return mappedPrompt || DEFAULT_DEFINITION_PROMPT;
	}

	getMappedAliasPrompt(fileType: string, path: string): string {
		let mappedPrompt: string | undefined;
		if (fileType === 'atomic') {
			mappedPrompt = this.config.folderAliasPromptMap?.[path];
		} else if (fileType === 'consolidated') {
			mappedPrompt = this.config.fileAliasPromptMap?.[path];
		}
		return mappedPrompt || DEFAULT_ALIAS_PROMPT;
	}

	private generatePrompt(word: string, fileType?: string, path?: string, context?: string): string {
		const customPrompt = (fileType && path)
			? this.getMappedPrompt(fileType, path)
			: DEFAULT_DEFINITION_PROMPT;

		let prompt: string;
		if (customPrompt.includes('{word}')) {
			prompt = customPrompt.replace(/\{word\}/g, word);
		} else {
			prompt = `${customPrompt}\n\n${t("Please provide a professional definition for \"{{word}}\".", { word })}`;
		}

		// 附加上下文
		if (context && context.trim()) {
			prompt += `\n\n${t("Context (the term appears in the following text):\n{{context}}", { context: context.trim() })}`;
		}

		return prompt;
	}

	private generateAliasPrompt(word: string, fileType?: string, path?: string, context?: string): string {
		const customPrompt = (fileType && path)
			? this.getMappedAliasPrompt(fileType, path)
			: DEFAULT_ALIAS_PROMPT;

		let prompt: string;
		if (customPrompt.includes('{word}')) {
			prompt = customPrompt.replace(/\{word\}/g, word);
		} else {
			prompt = `${customPrompt}\n\n${t("Please generate relevant aliases for \"{{word}}\".", { word })}`;
		}

		// 附加上下文
		if (context && context.trim()) {
			prompt += `\n\n${t("Context (the term appears in the following text):\n{{context}}", { context: context.trim() })}`;
		}

		return prompt;
	}

	// ────────────── 核心：通过 adapter 统一调用 ──────────────

	/**
	 * 统一的 AI 请求入口。所有供应商差异由 ProviderAdapter 处理。
	 * 如果 jsonMode 请求失败（推理模型可能不支持 response_format），
	 * 自动重试不带 jsonMode 的版本，依赖 Skill 文字约束 + tryParseJSON 兜底。
	 */
	private async callAI(entry: ProviderEntry, prompt: string, maxTokens: number, systemPrompt?: string, jsonMode?: boolean): Promise<string> {
		const adapter = getProtocol(entry.protocol);
		if (!adapter) {
			throw new Error(t("Invalid API provider configuration"));
		}

		const apiKey = this.getApiKey(entry);
		if (adapter.needsApiKey && !apiKey) {
			throw new Error(t("API key is not configured"));
		}

		// 发送请求的内部方法
		const sendRequest = async (useJsonMode: boolean): Promise<string> => {
			const { url, headers, body } = adapter.buildRequest(
				entry.model, apiKey, entry.baseUrl, prompt, maxTokens, systemPrompt, useJsonMode
			);

			const response = await requestUrl({
				url, method: 'POST', headers, body: JSON.stringify(body),
			});

			const data = response.json;
			if (response.status !== 200) {
				throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
			}

			return adapter.parseResponse(data);
		};

		// 先尝试带 jsonMode；失败则回退到不带 jsonMode
		if (jsonMode) {
			try {
				return await sendRequest(true);
			} catch (e) {
				console.warn("JSON mode failed, retrying without jsonMode:", e);
				return await sendRequest(false);
			}
		}

		return await sendRequest(false);
	}

	/** 尝试从 AI 返回文本中解析 JSON，失败则返回 null。 */
	private tryParseJSON(text: string): any | null {
		try {
			return JSON.parse(text);
		} catch {
			// 部分模型会在 JSON 前后包裹 ```json ... ```，尝试提取
			const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
			if (match) {
				try { return JSON.parse(match[1].trim()); } catch { /* */ }
			}
			return null;
		}
	}

	/** 清洗别名列表：去重、去噪声、截断。 */
	private cleanAliases(raw: string[], word: string): string[] {
		const seen = new Set<string>();
		return raw
			.map(a => a.trim())
			.filter(a => a && a !== word && a.length < 50
				&& !a.match(/^\d+\./)
				&& !/别名|例如|aliases?|for example|e\.g\.|：/i.test(a))
			.map(a => a.replace(/^["'`。，]+|["'`。，]+$/g, '').trim())
			.filter(a => a.length > 0)
			.filter(a => { const dup = seen.has(a.toLowerCase()); seen.add(a.toLowerCase()); return !dup; })
			.slice(0, 5);
	}

	// ────────────── 公开 API ──────────────

	async generateDefinition(word: string, fileType?: string, path?: string, context?: string): Promise<string> {
		const entry = this.getActiveProvider();
		if (!entry) {
			throw new Error(t("Please configure an AI provider and model first"));
		}
		const prompt = this.generatePrompt(word, fileType, path, context);
		const raw = await this.callAI(entry, prompt, MAX_TOKENS, DEFINITION_SKILL, true);

		// 结构化解析：提取 definition 字段；解析失败则回退为原文（兼容不规范模型）
		const parsed = this.tryParseJSON(raw);
		if (parsed && typeof parsed.definition === 'string') {
			return parsed.definition;
		}
		return raw;
	}

	async generateAliases(word: string, fileType?: string, path?: string, context?: string): Promise<string[]> {
		try {
			const entry = this.getActiveProvider();
			if (!entry) {
				throw new Error(t("Please configure an AI provider and model first"));
			}
			const aliasPrompt = this.generateAliasPrompt(word, fileType, path, context);
			const raw = await this.callAI(entry, aliasPrompt, MAX_ALIAS_TOKENS, ALIAS_SKILL, true);

			// 优先尝试 JSON 结构化解析
			const parsed = this.tryParseJSON(raw);
			if (parsed && Array.isArray(parsed.aliases)) {
				return this.cleanAliases(parsed.aliases, word);
			}

			// 回退：走老的纯文本分割逻辑（兼容不遵守 JSON 格式的模型）
			return this.cleanAliases(raw.split(/[,，、\n]/), word);
		} catch (error) {
			console.error('AI生成别名失败:', error);
			return [];
		}
	}
}
