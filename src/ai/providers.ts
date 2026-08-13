import { t } from "../i18n";
import { normalizeBaseUrl } from "../util/url";

/**
 * ============================================================
 *  协议适配器注册表
 * ============================================================
 *  绝大部分 AI 供应商都提供以下三种 API 协议之一：
 *
 *    openai-compatible — OpenAI 兼容格式（DeepSeek / 智谱 / 通义 / Moonshot / …）
 *    anthropic         — Anthropic Claude 格式
 *    local             — 本地 Ollama 格式
 *
 *  用户只需选择协议 + 填写 baseUrl / apiKey / model 即可。
 *  添加新协议：在下方 PROTOCOLS 对象中加一项即可。
 * ============================================================
 */

/** 构建好的 HTTP 请求描述。 */
export interface BuiltRequest {
	url: string;
	headers: Record<string, string>;
	body: any;
}

/**
 * 每种协议需要实现的适配器。
 */
export interface ProtocolAdapter {
	/** UI 显示名称 */
	label: string;

	/** 是否需要 API 密钥 */
	needsApiKey: boolean;

	/** 是否需要 baseUrl */
	needsBaseUrl: boolean;

	/** 默认 baseUrl（留空表示无） */
	defaultBaseUrl: string;

	/** 模型输入框 placeholder */
	modelsPlaceholder: string;

	/** 密钥输入框 placeholder */
	keyPlaceholder: string;

	/**
	 * 根据模型、密钥、baseUrl、system skill 和 prompt 文本，构建 HTTP 请求。
	 * systemPrompt 作为 system message 约束 AI 行为；prompt 作为 user message。
	 * jsonMode 为 true 时，启用各协议的 JSON mode 硬约束输出格式。
	 */
	buildRequest(model: string, apiKey: string, baseUrl: string | undefined, prompt: string, maxTokens: number, systemPrompt?: string, jsonMode?: boolean): BuiltRequest;

	/**
	 * 从 API 响应 JSON 中提取文本内容。出错应 throw Error。
	 */
	parseResponse(data: any): string;
}

// ──────────────────────────── 辅助函数 ────────────────────────────

/**
 * OpenAI 兼容的响应解析（兼容 reasoning_content 字段）。
 */
function parseOpenAICompatible(data: any): string {
	if (data?.error) {
		throw new Error(data.error.message || JSON.stringify(data.error));
	}
	const content = data?.choices?.[0]?.message?.content;
	if (content && typeof content === 'string' && content.trim()) {
		return content.trim();
	}
	// 兼容 glm-4.7 等模型，当 content 为空时使用 reasoning_content
	const reasoning = data?.choices?.[0]?.message?.reasoning_content;
	if (reasoning && typeof reasoning === 'string' && reasoning.trim()) {
		return reasoning.trim();
	}
	throw new Error(t("{{provider}} returned an invalid response: {{response}}", {
		provider: "API", response: JSON.stringify(data)
	}));
}

function buildOpenAIBody(model: string, prompt: string, maxTokens: number, temperature: number, systemPrompt?: string): any {
	const messages: any[] = [];
	if (systemPrompt) {
		messages.push({ role: 'system', content: systemPrompt });
	}
	messages.push({ role: 'user', content: prompt });
	return {
		model,
		messages,
		max_tokens: maxTokens,
		temperature,
	};
}

// ──────────────────────────── 协议注册表 ────────────────────────────

export const PROTOCOLS = {
	// ────── OpenAI 兼容格式 ──────
	// 适用于: OpenAI / DeepSeek / 智谱 GLM / 通义千问 / Moonshot / OpenRouter / 自建端点
	'openai-compatible': {
		label: 'OpenAI Compatible',
		needsApiKey: true,
		needsBaseUrl: true,
		defaultBaseUrl: 'https://api.openai.com/v1/chat/completions',
		modelsPlaceholder: 'gpt-4o, deepseek-chat, glm-4, qwen-plus, …',
		keyPlaceholder: 'sk-...',

		buildRequest(model, apiKey, baseUrl, prompt, maxTokens, systemPrompt?, jsonMode?): BuiltRequest {
			const base = normalizeBaseUrl(baseUrl || '');
			let url: string;
			if (base.endsWith('/chat/completions')) {
				url = base;
			} else if (/\/v\d+\/?$/.test(base)) {
				// 已含版本号（如 /v4），直接追加 /chat/completions
				url = `${base.replace(/\/+$/, '')}/chat/completions`;
			} else {
				url = `${base}/v1/chat/completions`;
			}
			const body = buildOpenAIBody(model, prompt, maxTokens, 0.7, systemPrompt);
			if (jsonMode) {
				body.response_format = { type: 'json_object' };
			}
			return {
				url,
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
				},
				body,
			};
		},

		parseResponse: parseOpenAICompatible,
	},

	// ────── Anthropic Claude 格式 ──────
	'anthropic': {
		label: 'Anthropic (Claude)',
		needsApiKey: true,
		needsBaseUrl: false,
		defaultBaseUrl: '',
		modelsPlaceholder: 'claude-sonnet-4-20250514, claude-opus-4-20250514, …',
		keyPlaceholder: 'sk-ant-...',

		buildRequest(model, apiKey, _baseUrl, prompt, maxTokens, systemPrompt?, _jsonMode?): BuiltRequest {
			// Anthropic 无原生 JSON mode，依赖 system prompt 约束
			const body: any = {
				model,
				max_tokens: maxTokens,
				messages: [{ role: 'user', content: prompt }],
			};
			if (systemPrompt) {
				body.system = systemPrompt;
			}
			return {
				url: 'https://api.anthropic.com/v1/messages',
				headers: {
					'x-api-key': apiKey,
					'anthropic-version': '2023-06-01',
					'Content-Type': 'application/json',
				},
				body,
			};
		},

		parseResponse(data: any): string {
			if (data?.error) {
				throw new Error(data.error.message || JSON.stringify(data.error));
			}
			const content = data?.content?.[0]?.text;
			if (content) return content.trim();
			throw new Error(t("{{provider}} returned an invalid response: {{response}}", {
				provider: "Anthropic API", response: JSON.stringify(data)
			}));
		},
	},

	// ────── 本地 Ollama ──────
	'local': {
		label: 'Local (Ollama)',
		needsApiKey: false,
		needsBaseUrl: true,
		defaultBaseUrl: 'http://localhost:11434',
		modelsPlaceholder: 'llama3.2, qwen2.5, mistral, …',
		keyPlaceholder: '',

		buildRequest(model, _apiKey, baseUrl, prompt, maxTokens, systemPrompt?, jsonMode?): BuiltRequest {
			const base = normalizeBaseUrl(baseUrl || '');
			const body: any = {
				model,
				prompt,
				stream: false,
				options: { temperature: 0.7, num_predict: maxTokens },
			};
			if (systemPrompt) {
				body.system = systemPrompt;
			}
			if (jsonMode) {
				body.format = 'json';
			}
			return {
				url: `${base}/api/generate`,
				headers: { 'Content-Type': 'application/json' },
				body,
			};
		},

		parseResponse(data: any): string {
			if (data?.error) {
				throw new Error(data.error);
			}
			if (data.response) return data.response.trim();
			throw new Error(t("{{provider}} returned an invalid response: {{response}}", {
				provider: "Ollama API", response: JSON.stringify(data)
			}));
		},
	},
} as Record<string, ProtocolAdapter>;

// ──────────────────────────── 自动派生的类型与辅助 ────────────────────────────

/** 协议类型 —— 从 PROTOCOLS 自动派生 */
export type APIProtocol = keyof typeof PROTOCOLS;

/** 所有协议列表（用于 UI 下拉） */
export const PROTOCOL_TYPES = Object.keys(PROTOCOLS) as APIProtocol[];

/** 获取协议适配器 */
export function getProtocol(type: string): ProtocolAdapter | undefined {
	return PROTOCOLS[type as APIProtocol];
}

/** 协议显示名称 */
export function protocolLabel(type: APIProtocol): string {
	return PROTOCOLS[type]?.label ?? type;
}

/** 是否在测试连接时可以验证响应 */
export function isTestResponseValid(protocol: APIProtocol, data: any): boolean {
	if (protocol === 'anthropic') {
		return Array.isArray(data?.content) && data.content.length > 0;
	}
	if (protocol === 'local') {
		return data !== undefined;
	}
	// openai-compatible
	return Array.isArray(data?.choices) && data.choices.length > 0;
}
