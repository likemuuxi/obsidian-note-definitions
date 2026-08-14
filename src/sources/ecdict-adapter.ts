import { App } from "obsidian";
import { getEcdictStore, EcdictEntry } from "./ecdict-store";
import {
	DefinitionCandidate,
	DefinitionLookupRequest,
	DefinitionSense,
	DefinitionSourceAdapter,
	DefinitionWordForm,
	EcdictVocabularyTag,
} from "./types";

const pluralize: (word: string) => string = require("pluralize");

const ECDICT_HOMEPAGE = "https://github.com/skywind3000/ECDICT";

const FORM_TYPES: Record<string, string> = {
	p: "word_past",
	d: "word_pp",
	i: "word_ing",
	"3": "word_third",
	r: "word_comparative",
	t: "word_superlative",
	s: "word_pl",
	"0": "word_lemma",
	"1": "word_form",
};

const POS_ALIASES: Record<string, string> = {
	n: "n",
	v: "v",
	vt: "v",
	vi: "v",
	a: "adj",
	adj: "adj",
	s: "adj",
	ad: "adv",
	adv: "adv",
	prep: "prep",
	pron: "pron",
	conj: "conj",
	num: "num",
	art: "art",
	aux: "aux",
	int: "int",
	interj: "int",
	abbr: "abbr",
	pref: "pref",
	suf: "suf",
};

export type EcdictEntryLoader = (term: string) => Promise<EcdictEntry | undefined>;

export class EcdictDefinitionSource implements DefinitionSourceAdapter {
	readonly id = "ecdict" as const;
	private loadEntry: EcdictEntryLoader;

	constructor(appOrLoader: App | EcdictEntryLoader) {
		this.loadEntry = typeof appOrLoader === "function"
			? appOrLoader
			: term => getEcdictStore(appOrLoader).lookup(term);
	}

	async lookup(request: DefinitionLookupRequest): Promise<DefinitionCandidate[]> {
		const requestedTerm = request.term.trim();
		if (!requestedTerm) return [];

		let entry = await this.loadEntry(requestedTerm);
		if (!entry) return [];

		const requestedForms = parseEcdictExchange(entry.exchange);
		const lemma = requestedForms.find(form => form.type === "word_lemma")?.value;
		if (lemma && normalizeWord(lemma) !== normalizeWord(entry.word)) {
			const lemmaEntry = await this.loadEntry(lemma);
			if (lemmaEntry?.translation) entry = lemmaEntry;
		}

		const senses = parseEcdictTranslation(entry.translation, entry.pos);
		if (senses.length === 0) return [];
		const options = request.sourceConfig;
		const vocabularyTagOptions = options && "vocabularyTags" in options
			&& options.vocabularyTagsEnabled
			? options.vocabularyTags
			: undefined;
		const forms = parseEcdictExchange(entry.exchange);
		if (!forms.some(form => form.type === "word_pl")
			&& senses.some(sense => sense.partOfSpeech === "n")) {
			const plural = pluralize(entry.word);
			if (normalizeWord(plural) !== normalizeWord(entry.word)
				&& await this.loadEntry(plural)) {
				forms.push({ type: "word_pl", value: plural });
			}
		}
		const aliases = deduplicate([
			...(normalizeWord(requestedTerm) !== normalizeWord(entry.word) ? [requestedTerm] : []),
			...forms
				.filter(form => form.type !== "word_lemma")
				.map(form => form.value),
		], entry.word);

		return [{
			id: `ecdict:${normalizeWord(entry.word)}`,
			sourceId: this.id,
			word: entry.word,
			language: "zh",
			entryLanguage: "English → 中文",
			aliases,
			senses,
			pronunciations: entry.phonetic
				? [{ text: normalizePhonetic(entry.phonetic) }]
				: undefined,
			forms: forms.length > 0 ? forms : undefined,
			englishSenses: options && "includeEnglishDefinition" in options
				&& options.includeEnglishDefinition && entry.definition
				? parseEcdictTranslation(entry.definition, entry.pos)
				: undefined,
			oxford3000: vocabularyTagOptions?.oxford3000
				? isOxford3000(entry.oxford)
				: undefined,
			examTags: vocabularyTagOptions
				? parseEcdictExamTags(entry.tag).filter(tag => {
					const key = tag.toLocaleLowerCase() as EcdictVocabularyTag;
					return key !== "oxford3000" && vocabularyTagOptions[key] === true;
				})
				: undefined,
			sourceUrl: ECDICT_HOMEPAGE,
			license: "MIT",
			score: 1300,
		}];
	}
}

export function parseEcdictTranslation(
	translation: string,
	posDistribution = "",
): DefinitionSense[] {
	const fallbackPos = parsePrimaryPartOfSpeech(posDistribution);
	const values = translation
		.split(/\r?\n/)
		.map(value => value.trim())
		.filter(Boolean)
		.map(value => parseTranslationLine(value, fallbackPos));
	const withoutNetworkGlosses = values.filter(value => !value.networkGloss);
	const selected = withoutNetworkGlosses.length > 0 ? withoutNetworkGlosses : values;
	const seen = new Set<string>();
	return selected.flatMap(value => {
		if (!value.definition) return [];
		const key = `${value.partOfSpeech || ""}\n${value.definition}`.toLocaleLowerCase();
		if (seen.has(key)) return [];
		seen.add(key);
		return [{
			definition: value.definition,
			partOfSpeech: value.partOfSpeech,
		}];
	});
}

export function parseEcdictExchange(exchange: string): DefinitionWordForm[] {
	const seen = new Set<string>();
	return exchange.split("/").flatMap(item => {
		const separator = item.indexOf(":");
		if (separator <= 0) return [];
		const code = item.slice(0, separator).trim();
		const value = item.slice(separator + 1).trim();
		const type = FORM_TYPES[code];
		const key = `${type}:${normalizeWord(value)}`;
		if (!type || !value || seen.has(key)) return [];
		seen.add(key);
		return [{ type, value }];
	});
}

export function parseEcdictExamTags(value: string): string[] {
	return deduplicateValues(value.split(/\s+/).map(tag => tag.trim()).filter(Boolean));
}

interface ParsedTranslationLine {
	definition: string;
	partOfSpeech?: string;
	networkGloss: boolean;
}

function parseTranslationLine(value: string, fallbackPos?: string): ParsedTranslationLine {
	const networkGloss = /^\[(?:网络|網絡|网络短语|網絡短語)\]/.test(value);
	const cleaned = value.replace(/^\[[^\]]+\]\s*/, "").trim();
	const match = cleaned.match(/^([a-z]+)\.\s*(.+)$/i);
	if (!match) {
		return { definition: cleaned, partOfSpeech: fallbackPos, networkGloss };
	}
	return {
		definition: match[2].trim(),
		partOfSpeech: normalizePartOfSpeech(match[1]) || fallbackPos,
		networkGloss,
	};
}

function parsePrimaryPartOfSpeech(value: string): string | undefined {
	let selected: { pos: string; weight: number } | undefined;
	for (const part of value.split("/")) {
		const match = part.trim().match(/^([a-z]+)(?::([0-9.]+))?$/i);
		if (!match) continue;
		const pos = normalizePartOfSpeech(match[1]);
		if (!pos) continue;
		const weight = Number(match[2] || 0);
		if (!selected || weight > selected.weight) selected = { pos, weight };
	}
	return selected?.pos;
}

function normalizePartOfSpeech(value: string): string | undefined {
	return POS_ALIASES[value.trim().toLocaleLowerCase()];
}

function isOxford3000(value: string): boolean {
	return value.trim() === "1" || value.trim().toLocaleLowerCase() === "true";
}

function deduplicateValues(values: string[]): string[] {
	const seen = new Set<string>();
	return values.filter(value => {
		const key = value.toLocaleLowerCase();
		if (!key || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function normalizePhonetic(value: string): string {
	return value
		.trim()
		.replace(/^\/(.*)\/$/, "$1")
		.replace(/^'/, "ˈ")
		.replace(/^,/, "ˌ")
		.replace(/ә/g, "ə");
}

function deduplicate(values: string[], word: string): string[] {
	const excluded = normalizeWord(word);
	const seen = new Set<string>();
	return values.filter(value => {
		const key = normalizeWord(value);
		if (!key || key === excluded || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function normalizeWord(value: string): string {
	return value.trim().toLocaleLowerCase();
}
