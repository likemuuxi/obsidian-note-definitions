import { DefinitionSourceHttpClient, requestDefinitionSourceJson } from "./http";
import { resolveDefinitionSourceLanguage } from "./language";
import {
	DefinitionCandidate,
	DefinitionLookupRequest,
	DefinitionSourceAdapter,
} from "./types";

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const ENTITY_LANGUAGES = ["zh", "zh-hans", "zh-hant", "en", "mul"];

export class WikidataDefinitionSource implements DefinitionSourceAdapter {
	readonly id = "wikidata" as const;

	constructor(private requestJson: DefinitionSourceHttpClient = requestDefinitionSourceJson) {}

	async lookup(request: DefinitionLookupRequest): Promise<DefinitionCandidate[]> {
		const language = resolveDefinitionSourceLanguage(request.language);
		const limit = Math.max(1, Math.min(request.limit ?? 6, 10));
		const searchUrl = new URL(WIKIDATA_API);
		searchUrl.search = new URLSearchParams({
			action: "wbsearchentities",
			search: request.term,
			language,
			uselang: language,
			type: "item",
			limit: String(limit),
			format: "json",
			formatversion: "2",
		}).toString();

		const searchPayload = asRecord(await this.requestJson(searchUrl.toString()));
		throwApiError(searchPayload, "Wikidata search");
		const searchResults = Array.isArray(searchPayload.search)
			? searchPayload.search.filter(isRecord)
			: [];
		const ids = searchResults
			.map(result => typeof result.id === "string" ? result.id : "")
			.filter(Boolean);
		if (ids.length === 0) return [];

		const entitiesUrl = new URL(WIKIDATA_API);
		entitiesUrl.search = new URLSearchParams({
			action: "wbgetentities",
			ids: ids.join("|"),
			props: "labels|descriptions|aliases",
			languages: ENTITY_LANGUAGES.join("|"),
			languagefallback: "1",
			format: "json",
			formatversion: "2",
		}).toString();

		const entitiesPayload = asRecord(await this.requestJson(entitiesUrl.toString()));
		throwApiError(entitiesPayload, "Wikidata entities");
		const entities = asRecord(entitiesPayload.entities);

		return searchResults.flatMap((result, index) => {
			const id = typeof result.id === "string" ? result.id : "";
			const entity = asRecord(entities[id]);
			if (!id || Object.keys(entity).length === 0 || entity.missing !== undefined) return [];

			const labels = readLocalizedValues(entity.labels);
			const descriptions = readLocalizedValues(entity.descriptions);
			const preferredOrder = language === "zh"
				? ["zh-hans", "zh", "zh-hant", "en", "mul"]
				: ["en", "zh-hans", "zh", "zh-hant", "mul"];
			const preferredLabel = pickLocalizedValue(labels, preferredOrder);
			const preferredDescription = pickLocalizedValue(descriptions, preferredOrder);
			const searchLabel = typeof result.label === "string" ? result.label : undefined;
			const word = preferredLabel?.value || searchLabel || request.term;
			const aliases = collectAliases(entity, labels, result, request.term, word);
			const exactMatch = normalizeTerm(word) === normalizeTerm(request.term)
				|| aliases.some(alias => normalizeTerm(alias) === normalizeTerm(request.term));
			const sourceUrl = `https://www.wikidata.org/wiki/${encodeURIComponent(id)}`;

			return [{
				id,
				sourceId: this.id,
				word,
				language: preferredDescription?.language || preferredLabel?.language || language,
				aliases,
				senses: preferredDescription
					? [{ definition: preferredDescription.value }]
					: [],
				sourceUrl,
				license: "CC0 1.0",
				score: 1000 - index * 10 + (exactMatch ? 5 : 0),
			}];
		});
	}
}

interface LocalizedValue {
	language: string;
	value: string;
}

function collectAliases(
	entity: Record<string, any>,
	labels: Map<string, LocalizedValue>,
	searchResult: Record<string, any>,
	term: string,
	word: string,
): string[] {
	const values: string[] = [];
	labels.forEach(label => values.push(label.value));

	const aliases = asRecord(entity.aliases);
	for (const languageAliases of Object.values(aliases)) {
		if (!Array.isArray(languageAliases)) continue;
		for (const alias of languageAliases) {
			if (isRecord(alias) && typeof alias.value === "string") values.push(alias.value);
		}
	}

	if (Array.isArray(searchResult.aliases)) {
		values.push(...searchResult.aliases.filter((alias): alias is string => typeof alias === "string"));
	}
	const match = asRecord(searchResult.match);
	if (typeof match.text === "string") values.push(match.text);

	const excluded = new Set([normalizeTerm(term), normalizeTerm(word)]);
	const seen = new Set<string>();
	return values.filter(value => {
		const normalized = normalizeTerm(value);
		if (!normalized || excluded.has(normalized) || seen.has(normalized)) return false;
		seen.add(normalized);
		return true;
	});
}

function readLocalizedValues(value: unknown): Map<string, LocalizedValue> {
	const result = new Map<string, LocalizedValue>();
	const record = asRecord(value);
	for (const [language, localized] of Object.entries(record)) {
		if (!isRecord(localized) || typeof localized.value !== "string") continue;
		result.set(language, {
			language: typeof localized.language === "string" ? localized.language : language,
			value: localized.value,
		});
	}
	return result;
}

function pickLocalizedValue(
	values: Map<string, LocalizedValue>,
	order: string[],
): LocalizedValue | undefined {
	for (const language of order) {
		const value = values.get(language);
		if (value) return value;
	}
	return values.values().next().value;
}

function throwApiError(payload: Record<string, any>, operation: string): void {
	if (!isRecord(payload.error)) return;
	const message = typeof payload.error.info === "string"
		? payload.error.info
		: JSON.stringify(payload.error);
	throw new Error(`${operation}: ${message}`);
}

function normalizeTerm(value: string): string {
	return value.trim().toLocaleLowerCase();
}

function asRecord(value: unknown): Record<string, any> {
	return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
