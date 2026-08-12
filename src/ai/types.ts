import { t } from "../i18n";
import type { APIProtocol } from "./providers";

// ────────────── Prompt 常量 ──────────────

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
	customPrompt?: string;
	customAliasPrompt?: string;
	folderPromptMap?: Record<string, string>;
	filePromptMap?: Record<string, string>;
	folderAliasPromptMap?: Record<string, string>;
	fileAliasPromptMap?: Record<string, string>;
}
