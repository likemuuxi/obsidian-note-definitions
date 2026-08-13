import { t } from "../i18n";
import type { APIProtocol } from "./providers";

// ────────────── Skill 常量（system message 层，插件维护，用户不可改） ──────────────

/**
 * 定义生成 Skill —— 强制 AI 返回 JSON 结构，插件解析后提取 definition 字段。
 * 配合各协议的 JSON mode（OpenAI response_format / Ollama format）实现硬约束。
 */
export const DEFINITION_SKILL = `You are a definition generator for an Obsidian note plugin. You MUST respond with ONLY a valid JSON object, no other text.
The JSON must have exactly this shape:
{"definition": "<definition content in Markdown>"}

Rules:
1. "definition" value must be valid Markdown content.
2. No conversational filler, no preamble, no postamble — output ONLY the JSON object.
3. Use the same language as the user prompt implies.
4. Be accurate, concise, and professional.
5. Do NOT wrap the JSON in markdown code blocks.`;

/**
 * 别名生成 Skill —— 强制 AI 返回 JSON 结构，插件解析后提取 aliases 数组。
 */
export const ALIAS_SKILL = `You are an alias generator for an Obsidian note plugin. You MUST respond with ONLY a valid JSON object, no other text.
The JSON must have exactly this shape:
{"aliases": ["alias1", "alias2", ...]}

Rules:
1. "aliases" is an array of strings.
2. Each alias must be concise (under 50 characters).
3. Do not include the original term itself.
4. Return at most 8 aliases.
5. No conversational filler, no preamble, no postamble — output ONLY the JSON object.`;

// ────────────── Prompt 常量（user message 层，用户可自定义） ──────────────

export const DEFAULT_DEFINITION_PROMPT = t("Default definition AI prompt");
export const DEFAULT_ALIAS_PROMPT = t("Default alias AI prompt");

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

// ────────────── 数据模型 ──────────────

/**
 * 一个已配置的 AI 供应商。可以有多个共存。
 * secretKey 指向 Obsidian SecretStorage 中的密钥名称（def- 前缀）。
 */
export interface ProviderEntry {
	id: string;
	protocol: APIProtocol;
	name: string;
	model: string;
	baseUrl?: string;
	secretKey?: string; // SecretStorage 中的密钥名称（如 def-openai-key）
}

/** 旧版供应商配置（多供应商改造前），仅用于迁移 */
export interface ProviderConfig {
	apiKey?: string;
	model?: string;
	baseUrl?: string;
}

export interface AIConfig {
	enabled: boolean;
	activeProviderId?: string;
	providers: ProviderEntry[];
	folderPromptMap?: Record<string, string>;
	filePromptMap?: Record<string, string>;
	folderAliasPromptMap?: Record<string, string>;
	fileAliasPromptMap?: Record<string, string>;
	contextAwareEnabled?: boolean;
}
