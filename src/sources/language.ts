import { getLocale } from "../i18n";
import { DefinitionSourceLanguage } from "./types";

export type ResolvedDefinitionSourceLanguage = "zh" | "en";

export function resolveDefinitionSourceLanguage(
	language: DefinitionSourceLanguage,
): ResolvedDefinitionSourceLanguage {
	if (language === "zh" || language === "en") return language;
	return getLocale() === "zh-CN" ? "zh" : "en";
}

