import { en, TranslationKey } from "./locales/en";
import { zhCN } from "./locales/zh-cn";

export type SupportedLocale = "en" | "zh-CN";
export type TranslationParams = Record<string, string | number>;

const locales: Record<SupportedLocale, Record<TranslationKey, string>> = {
	en,
	"zh-CN": zhCN
};

export function normalizeLocale(locale?: string | null): SupportedLocale {
	const normalized = locale?.trim().toLowerCase().replace(/_/g, "-") ?? "";
	return normalized === "zh" || normalized.startsWith("zh-") ? "zh-CN" : "en";
}

export function getLocale(): SupportedLocale {
	try {
		const obsidianLanguage = typeof window !== "undefined"
			? window.localStorage?.getItem("language")
			: null;
		if (obsidianLanguage) {
			return normalizeLocale(obsidianLanguage);
		}
	} catch {
		// Access to localStorage can be unavailable in tests or restricted webviews.
	}

	return normalizeLocale(typeof navigator !== "undefined" ? navigator.language : null);
}

export function translate(locale: SupportedLocale, key: TranslationKey, params: TranslationParams = {}): string {
	const template = locales[locale][key] ?? en[key];
	return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
		const value = params[name];
		return value === undefined ? match : String(value);
	});
}

export function t(key: TranslationKey, params?: TranslationParams): string {
	return translate(getLocale(), key, params);
}
