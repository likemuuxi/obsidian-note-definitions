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

	async generateDefinition(word: string, fileType?: string, path?: string): Promise<string> {
		const currentProvider = this.config.currentProvider || 'openai';
		const providerConfig = this.config.providers?.[currentProvider as keyof typeof this.config.providers];

		if (currentProvider !== 'ollama' && !providerConfig?.apiKey) {
			throw new Error("API Key未配置");
		}

		// 根据提供商构建API URL和请求体
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
				messages: [
					{
						role: 'user',
						content: promptText
					}
				],
				max_tokens: 300,
				temperature: 0.7
			};
		} else if (currentProvider === 'gemini') {
			apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${providerConfig?.model}:generateContent?key=${providerConfig?.apiKey}`;
			headers = {
				'Content-Type': 'application/json',
			};
			requestBody = {
				contents: [{
					parts: [{
						text: this.generatePrompt(word, fileType, path)
					}]
				}],
				generationConfig: {
					temperature: 0.7,
					maxOutputTokens: 300,
				}
			};
		} else if (currentProvider === 'ollama') {
			apiUrl = `${providerConfig?.baseUrl}/api/generate`;
			headers = {
				'Content-Type': 'application/json',
			};
			requestBody = {
				model: providerConfig?.model,
				prompt: this.generatePrompt(word, fileType, path),
				stream: false,
				options: {
					temperature: 0.7,
					num_predict: 300
				}
			};
		} else if (currentProvider === 'custom' && providerConfig?.baseUrl) {
			apiUrl = `${providerConfig.baseUrl}/v1/chat/completions`;
			headers = {
				'Authorization': `Bearer ${providerConfig?.apiKey}`,
				'Content-Type': 'application/json',
			};
			
			const promptText = this.generatePrompt(word, fileType, path);
			requestBody = {
				model: providerConfig?.model,
				messages: [
					{
						role: 'user',
						content: promptText
					}
				],
				max_tokens: 300,
				temperature: 0.7
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
			
			// 根据不同提供商解析响应
			if (currentProvider === 'openai' || currentProvider === 'custom') {
				if (data.choices && data.choices[0] && data.choices[0].message) {
					return data.choices[0].message.content.trim();
				} else {
					throw new Error('API 返回格式错误');
				}
			} else if (currentProvider === 'gemini') {
				if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
					return data.candidates[0].content.parts[0].text.trim();
				} else {
					throw new Error('Gemini API 返回格式错误');
				}
			} else if (currentProvider === 'ollama') {
				if (data.response) {
					return data.response.trim();
				} else {
					throw new Error('Ollama API 返回格式错误');
				}
			}
			
			throw new Error('未知的API响应格式');
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

		// 使用设置中的自定义别名prompt
		const aliasPrompt = this.generateAliasPrompt(word, fileType, path);

		// 根据提供商构建API URL和请求体
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
				messages: [
					{
						role: 'user',
						content: aliasPrompt
					}
				],
				max_tokens: 100,
				temperature: 0.3
			};
		} else if (currentProvider === 'gemini') {
			apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${providerConfig?.model}:generateContent?key=${providerConfig?.apiKey}`;
			headers = {
				'Content-Type': 'application/json',
			};
			requestBody = {
				contents: [{
					parts: [{
						text: aliasPrompt
					}]
				}],
				generationConfig: {
					temperature: 0.3,
					maxOutputTokens: 100,
				}
			};
		} else if (currentProvider === 'ollama') {
			apiUrl = `${providerConfig?.baseUrl}/api/generate`;
			headers = {
				'Content-Type': 'application/json',
			};
			requestBody = {
				model: providerConfig?.model,
				prompt: aliasPrompt,
				stream: false,
				options: {
					temperature: 0.3,
					num_predict: 100
				}
			};
		} else if (currentProvider === 'custom' && providerConfig?.baseUrl) {
			apiUrl = `${providerConfig.baseUrl}/v1/chat/completions`;
			headers = {
				'Authorization': `Bearer ${providerConfig?.apiKey}`,
				'Content-Type': 'application/json',
			};
			requestBody = {
				model: providerConfig?.model,
				messages: [
					{
						role: 'user',
						content: aliasPrompt
					}
				],
				max_tokens: 100,
				temperature: 0.3
			};
		} else {
			throw new Error("无效的API提供商配置");
		}

		const response = await requestUrl({
			url: apiUrl,
			method: 'POST',
			headers: headers,
			body: JSON.stringify(requestBody)
		});

		const data = response.json;
		let aliasText = '';

		// 根据不同提供商解析响应
		if (currentProvider === 'openai' || currentProvider === 'custom') {
			if (data.choices && data.choices[0] && data.choices[0].message) {
				aliasText = data.choices[0].message.content.trim();
			}
		} else if (currentProvider === 'gemini') {
			if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
				aliasText = data.candidates[0].content.parts[0].text.trim();
			}
		} else if (currentProvider === 'ollama') {
			if (data.response) {
				aliasText = data.response.trim();
			}
		}

		if (!aliasText) {
			throw new Error('AI返回空的别名结果');
		}

		// 简单清理AI返回的别名列表
		const aliases = aliasText
			.split(/[,，、\n]/)
			.map(alias => alias.trim())
			.filter(alias => {
				return alias.length > 0 && 
					   alias !== word && 
					   alias.length < 50 && // 过滤过长的文本
					   !alias.match(/^\d+\./) && // 去掉编号
					   !alias.includes('别名') &&
					   !alias.includes('例如') &&
					   !alias.includes('：');
			})
			.map(alias => alias.replace(/^["""''`。，]+|["""''`。，]+$/g, '').trim()) // 去掉标点符号
			.filter(alias => alias.length > 0)
			.slice(0, 5); // 最多保留5个别名

		return aliases;
	}
} 