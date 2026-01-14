import { requestUrl } from "obsidian";

// 从settings.ts导入常量和接口
import { DEFAULT_DEFINITION_PROMPT, DEFAULT_ALIAS_PROMPT, AIConfig } from "../settings";

export class AIService {
	private config: AIConfig;

	constructor(config: AIConfig) {
		this.config = config;
	}

	get aiConfig(): AIConfig {
		return this.config;
	}

	updateConfig(config: AIConfig) {
		this.config = config;
	}

	// 获取映射的prompt（用于定义生成）
	getMappedPrompt(fileType: string, path: string): string {
		let mappedPrompt: string | undefined;

		if (fileType === 'atomic') {
			// 对于atomic类型，path是文件夹路径
			mappedPrompt = this.config.folderPromptMap?.[path];
		} else if (fileType === 'consolidated') {
			// 对于consolidated类型，path是文件路径
			mappedPrompt = this.config.filePromptMap?.[path];
		}

		// 如果没有找到映射的prompt，使用默认的customPrompt
		return mappedPrompt || this.config.customPrompt || DEFAULT_DEFINITION_PROMPT;
	}

	// 获取映射的别名prompt
	getMappedAliasPrompt(fileType: string, path: string): string {
		let mappedPrompt: string | undefined;

		if (fileType === 'atomic') {
			// 对于atomic类型，path是文件夹路径
			mappedPrompt = this.config.folderAliasPromptMap?.[path];
		} else if (fileType === 'consolidated') {
			// 对于consolidated类型，path是文件路径
			mappedPrompt = this.config.fileAliasPromptMap?.[path];
		}

		// 如果没有找到映射的prompt，使用默认的customAliasPrompt
		return mappedPrompt || this.config.customAliasPrompt || DEFAULT_ALIAS_PROMPT;
	}

	private generatePrompt(word: string, fileType?: string, path?: string): string {
		let customPrompt: string;

		// 如果提供了fileType和path，尝试获取映射的prompt
		if (fileType && path) {
			customPrompt = this.getMappedPrompt(fileType, path);
		} else {
			customPrompt = this.config.customPrompt || DEFAULT_DEFINITION_PROMPT;
		}

		// 如果prompt中包含{word}占位符，则替换它
		if (customPrompt.includes('{word}')) {
			return customPrompt.replace(/\{word\}/g, word);
		} else {
			// 如果没有占位符，则在prompt后面添加词语
			return `${customPrompt}\n\n请为"${word}"提供一个专业的定义。`;
		}
	}

	private generateAliasPrompt(word: string, fileType?: string, path?: string): string {
		let customPrompt: string;

		// 如果提供了fileType和path，尝试获取映射的别名prompt
		if (fileType && path) {
			customPrompt = this.getMappedAliasPrompt(fileType, path);
		} else {
			customPrompt = this.config.customAliasPrompt || DEFAULT_ALIAS_PROMPT;
		}

		// 如果prompt中包含{word}占位符，则替换它
		if (customPrompt.includes('{word}')) {
			return customPrompt.replace(/\{word\}/g, word);
		} else {
			// 如果没有占位符，则在prompt后面添加词语
			return `${customPrompt}\n\n请为"${word}"生成相关的别名。`;
		}
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

	async generateDefinition(word: string, fileType?: string, path?: string): Promise<string> {
		const currentProvider = this.config.currentProvider || 'openai';
		const providerConfig = this.config.providers?.[currentProvider as keyof typeof this.config.providers];

		if (currentProvider !== 'ollama' && !providerConfig?.apiKey) {
			throw new Error("API Key未配置");
		}

		let apiUrl: string;
		let requestBody: any;
		let headers: Record<string, string>;

		if (currentProvider === 'openai') {
			apiUrl = 'https://api.openai.com/v1/chat/completions';
			headers = {
				'Authorization': `Bearer ${providerConfig?.apiKey}`,
				'Content-Type': 'application/json',
			};

			const promptText = this.generatePrompt(word, fileType, path);
			requestBody = {
				model: providerConfig?.model,
				messages: [{ role: 'user', content: promptText }],
				max_tokens: 300,
				temperature: 0.7
			};

		} else if (currentProvider === 'gemini') {

			apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${providerConfig?.model}:generateContent?key=${providerConfig?.apiKey}`;
			headers = { 'Content-Type': 'application/json' };
			requestBody = {
				contents: [{ parts: [{ text: this.generatePrompt(word, fileType, path) }] }],
				generationConfig: { temperature: 0.7, maxOutputTokens: 300 }
			};

		} else if (currentProvider === 'ollama') {

			const base = this.normalizeBaseUrl(providerConfig?.baseUrl || '');
			apiUrl = `${base}/api/generate`;
			headers = { 'Content-Type': 'application/json' };
			requestBody = {
				model: providerConfig?.model,
				prompt: this.generatePrompt(word, fileType, path),
				stream: false,
				options: { temperature: 0.7, num_predict: 300 }
			};

		} else if (currentProvider === 'custom' && providerConfig?.baseUrl) {

			const base = this.normalizeBaseUrl(providerConfig.baseUrl);
			if (base.endsWith("/chat/completions")) {
				apiUrl = base;
			} else {
				apiUrl = `${base}/v1/chat/completions`;
			}
			headers = {
				'Authorization': `Bearer ${providerConfig?.apiKey}`,
				'Content-Type': 'application/json',
			};

			const promptText = this.generatePrompt(word, fileType, path);
			requestBody = {
				model: providerConfig?.model,
				messages: [{ role: 'user', content: promptText }],
				max_tokens: 2000,
				temperature: 0.7
			};

		} else if (currentProvider === 'zhipu') {
			apiUrl = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
			headers = {
				'Authorization': `Bearer ${providerConfig?.apiKey}`,
				'Content-Type': 'application/json',
			};

			const promptText = this.generatePrompt(word, fileType, path);
			requestBody = {
				model: providerConfig?.model,
				messages: [{ role: 'user', content: promptText }],
				max_tokens: 300,
				temperature: 0.7
			};

			// 强制禁用 Thinking Mode
			(requestBody as any).extra_body = {
				chat_template_kwargs: {
					enable_thinking: false
				}
			};
		} else {
			throw new Error("无效的API提供商配置");
		}

		try {
			const response = await requestUrl({
				url: apiUrl,
				method: 'POST',
				headers: headers,
				body: JSON.stringify(requestBody)
			});

			const data = response.json;
			// console.log('AI data 响应数据:', JSON.stringify(data, null, 2));

			if (currentProvider === 'openai' || currentProvider === 'custom' || currentProvider === 'zhipu') {
				if (data?.error) {
					throw new Error(`API调用失败: ${data.error.message || JSON.stringify(data.error)}`);
				}
				const content = data?.choices?.[0]?.message?.content;
				const reasoningContent = data?.choices?.[0]?.message?.reasoning_content;

				if (content && typeof content === 'string' && content.trim().length > 0) {
					return content.trim();
				}

				// 兼容 glm-4.7 等模型，当 content 为空时尝试使用 reasoning_content
				if (reasoningContent && typeof reasoningContent === 'string' && reasoningContent.trim().length > 0) {
					console.log('Using reasoning_content as fallback');
					return reasoningContent.trim();
				}

				throw new Error(`API 返回格式错误。完整响应: ${JSON.stringify(data)}`);
			}

			if (currentProvider === 'gemini') {
				if (data?.error) {
					throw new Error(`Gemini API调用失败: ${data.error.message || JSON.stringify(data.error)}`);
				}
				const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
				if (content) {
					return content.trim();
				}
				throw new Error(`Gemini API 返回格式错误。完整响应: ${JSON.stringify(data)}`);
			}

			if (currentProvider === 'ollama') {
				if (data?.error) {
					throw new Error(`Ollama API调用失败: ${data.error}`);
				}
				const content = data?.response;
				if (content) {
					return content.trim();
				}
				throw new Error(`Ollama API 返回格式错误。完整响应: ${JSON.stringify(data)}`);
			}

			throw new Error(`未知的API提供商: ${currentProvider}`);
		} catch (error) {
			console.error('AI API 调用失败:', error);
			throw error;
		}
	}

	async generateAliases(word: string, fileType?: string, path?: string): Promise<string[]> {
		// 使用AI生成别名
		try {
			const aliases = await this.generateAliasesWithAI(word, fileType, path);
			return aliases;
		} catch (error) {
			console.error('AI生成别名失败:', error);
			return [];
		}
	}

	private async generateAliasesWithAI(word: string, fileType?: string, path?: string): Promise<string[]> {
		const currentProvider = this.config.currentProvider || 'openai';
		const providerConfig = this.config.providers?.[currentProvider as keyof typeof this.config.providers];

		if (currentProvider !== 'ollama' && !providerConfig?.apiKey) {
			throw new Error("API Key未配置");
		}

		const aliasPrompt = this.generateAliasPrompt(word, fileType, path);

		let apiUrl: string;
		let requestBody: any;
		let headers: Record<string, string>;

		if (currentProvider === 'openai') {
			apiUrl = 'https://api.openai.com/v1/chat/completions';
			headers = {
				'Authorization': `Bearer ${providerConfig?.apiKey}`,
				'Content-Type': 'application/json',
			};
			requestBody = {
				model: providerConfig?.model,
				messages: [{ role: 'user', content: aliasPrompt }],
				max_tokens: 100,
				temperature: 0.3
			};
		} else if (currentProvider === 'zhipu') {
			apiUrl = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
			headers = {
				'Authorization': `Bearer ${providerConfig?.apiKey}`,
				'Content-Type': 'application/json',
			};
			requestBody = {
				model: providerConfig?.model,
				messages: [{ role: 'user', content: aliasPrompt }],
				max_tokens: 100,
				temperature: 0.3
			};
			(requestBody as any).extra_body = {
				chat_template_kwargs: {
					enable_thinking: false
				}
			};
		} else if (currentProvider === 'gemini') {
			apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${providerConfig?.model}:generateContent?key=${providerConfig?.apiKey}`;
			headers = { 'Content-Type': 'application/json' };
			requestBody = {
				contents: [{ parts: [{ text: aliasPrompt }] }],
				generationConfig: { temperature: 0.3, maxOutputTokens: 100 }
			};
		} else if (currentProvider === 'ollama') {
			const base = this.normalizeBaseUrl(providerConfig?.baseUrl || '');
			apiUrl = `${base}/api/generate`;
			headers = { 'Content-Type': 'application/json' };
			requestBody = {
				model: providerConfig?.model,
				prompt: aliasPrompt,
				stream: false,
				options: { temperature: 0.3, num_predict: 100 }
			};
		} else if (currentProvider === 'custom' && providerConfig?.baseUrl) {
			const base = this.normalizeBaseUrl(providerConfig.baseUrl);
			if (base.endsWith("/chat/completions")) {
				apiUrl = base;
			} else {
				apiUrl = `${base}/v1/chat/completions`;
			}
			headers = {
				'Authorization': `Bearer ${providerConfig?.apiKey}`,
				'Content-Type': 'application/json',
			};
			requestBody = {
				model: providerConfig?.model,
				messages: [{ role: 'user', content: aliasPrompt }],
				max_tokens: 100,
				temperature: 0.3
			};
		} else {
			throw new Error("无效的API提供商配置");
		}

		try {
			const response = await requestUrl({
				url: apiUrl,
				method: 'POST',
				headers: headers,
				body: JSON.stringify(requestBody)
			});

			const data = response.json;
			// console.log('AI data 响应数据:', JSON.stringify(data, null, 2));

			let aliasText = '';

			if (currentProvider === 'openai' || currentProvider === 'custom' || currentProvider === 'zhipu') {
				if (data?.error) {
					throw new Error(`API Error: ${data.error.message || JSON.stringify(data.error)}`);
				}
				if (data.choices?.[0]?.message) {
					const content = data.choices[0].message.content;
					const reasoningContent = data.choices[0].message.reasoning_content;

					if (content && content.trim()) {
						aliasText = content.trim();
					} else if (reasoningContent && reasoningContent.trim()) {
						// 兼容 glm-4.7 等模型
						aliasText = reasoningContent.trim();
					}
				}
			} else if (currentProvider === 'gemini') {
				if (data?.error) {
					throw new Error(`Gemini API Error: ${data.error.message || JSON.stringify(data.error)}`);
				}
				if (data.candidates?.[0]?.content?.parts) {
					aliasText = data.candidates[0].content.parts[0].text.trim();
				}
			} else if (currentProvider === 'ollama') {
				if (data?.error) {
					throw new Error(`Ollama API Error: ${data.error}`);
				}
				if (data.response) aliasText = data.response.trim();
			}

			if (!aliasText) throw new Error(`AI返回空的别名结果。完整响应: ${JSON.stringify(data)}`);

			const aliases = aliasText
				.split(/[,，、\n]/)
				.map(a => a.trim())
				.filter(a => a && a !== word && a.length < 50 && !a.match(/^\d+\./) && !/别名|例如|：/.test(a))
				.map(a => a.replace(/^["'`。，]+|["'`。，]+$/g, '').trim())
				.filter(a => a.length > 0)
				.slice(0, 5);

			return aliases;
		} catch (error) {
			console.error('AI 别名生成失败:', error);
			throw error;
		}
	}
} 