import { DefinitionSourceHttpClient, requestDefinitionSourceJson } from "./http";
import { resolveDefinitionSourceLanguage, ResolvedDefinitionSourceLanguage } from "./language";
import {
	DefinitionCandidate,
	DefinitionExample,
	DefinitionLookupRequest,
	DefinitionSense,
	DefinitionSourceAdapter,
} from "./types";

type WiktionaryHtmlParser = (
	html: string,
	term: string,
	wikiLanguage: ResolvedDefinitionSourceLanguage,
	limit: number,
) => DefinitionCandidate[];

const PARTS_OF_SPEECH = new Set([
	"noun", "proper noun", "verb", "adjective", "adverb", "pronoun", "preposition",
	"conjunction", "interjection", "determiner", "article", "numeral", "participle",
	"particle", "prefix", "suffix", "phrase", "proverb", "idiom", "abbreviation",
	"initialism", "symbol", "letter", "character", "classifier", "counter",
	"名词", "名詞", "专有名词", "專有名詞", "动词", "動詞", "形容词", "形容詞",
	"副词", "副詞", "代词", "代詞", "介词", "介詞", "连词", "連詞", "叹词",
	"嘆詞", "感叹词", "感嘆詞", "数词", "數詞", "量词", "量詞", "助词",
	"助詞", "冠词", "冠詞", "限定词", "限定詞", "短语", "短語", "成语",
	"成語", "谚语", "諺語", "缩写", "縮寫", "符号", "符號", "汉字", "漢字",
]);

export class WiktionaryDefinitionSource implements DefinitionSourceAdapter {
	readonly id = "wiktionary" as const;

	constructor(
		private requestJson: DefinitionSourceHttpClient = requestDefinitionSourceJson,
		private parseHtml: WiktionaryHtmlParser = parseWiktionaryHtml,
	) {}

	async lookup(request: DefinitionLookupRequest): Promise<DefinitionCandidate[]> {
		let language = resolveDefinitionSourceLanguage(request.language);
		const limit = Math.max(1, Math.min(request.limit ?? 6, 10));
		let lookupTerm = request.term;
		let html = await this.fetchPage(lookupTerm, language);
		if (!html) {
			language = language === "zh" ? "en" : "zh";
			html = await this.fetchPage(lookupTerm, language);
		}
		if (!html) return [];

		const canonicalTerm = findWiktionaryCanonicalTerm(html, language);
		if (canonicalTerm && normalizeTerm(canonicalTerm) !== normalizeTerm(lookupTerm)) {
			const canonicalHtml = await this.fetchPage(canonicalTerm, language);
			if (canonicalHtml) {
				lookupTerm = canonicalTerm;
				html = canonicalHtml;
			}
		}

		const candidates = this.parseHtml(html, lookupTerm, language, limit);
		if (normalizeTerm(lookupTerm) === normalizeTerm(request.term)) return candidates;
		return candidates.map(candidate => ({
			...candidate,
			aliases: deduplicateStrings([...candidate.aliases, request.term]),
		}));
	}

	private async fetchPage(
		term: string,
		language: ResolvedDefinitionSourceLanguage,
	): Promise<string | undefined> {
		const apiUrl = new URL(`https://${language}.wiktionary.org/w/api.php`);
		apiUrl.search = new URLSearchParams({
			action: "parse",
			page: term,
			prop: "text|displaytitle",
			format: "json",
			formatversion: "2",
			redirects: "1",
			disableeditsection: "1",
		}).toString();

		const payload = asRecord(await this.requestJson(apiUrl.toString()));
		if (isRecord(payload.error)) {
			if (payload.error.code === "missingtitle") return undefined;
			const message = typeof payload.error.info === "string"
				? payload.error.info
				: JSON.stringify(payload.error);
			throw new Error(`Wiktionary: ${message}`);
		}
		const parsed = asRecord(payload.parse);
		return typeof parsed.text === "string" ? parsed.text : undefined;
	}
}

export function findWiktionaryCanonicalTerm(
	html: string,
	wikiLanguage: ResolvedDefinitionSourceLanguage,
): string | undefined {
	if (wikiLanguage !== "zh") return undefined;
	if (typeof DOMParser !== "undefined") {
		const document = new DOMParser().parseFromString(html, "text/html");
		const reference = document.querySelector("table.zh-see");
		if (!reference) return undefined;
		const canonicalLink = reference.querySelector(".Hant a[title]")
			|| Array.from(reference.querySelectorAll("a[title]")).pop();
		const title = canonicalLink?.getAttribute("title")?.trim();
		if (title) return title;
	}

	const referenceHtml = html.match(/<table[^>]*\bzh-see\b[^>]*>[\s\S]*?<\/table>/i)?.[0];
	if (!referenceHtml) return undefined;
	const traditionalSection = referenceHtml.match(/<span[^>]*\bHant\b[^>]*>[\s\S]*?<\/span>/i)?.[0];
	const titleMatch = (traditionalSection || referenceHtml).match(/<a[^>]*\btitle=["']([^"']+)["']/i);
	return titleMatch ? decodeHtmlAttribute(titleMatch[1]).trim() || undefined : undefined;
}

export function parseWiktionaryHtml(
	html: string,
	term: string,
	wikiLanguage: ResolvedDefinitionSourceLanguage,
	limit: number,
): DefinitionCandidate[] {
	if (typeof DOMParser === "undefined") {
		throw new Error("Wiktionary HTML parsing is unavailable in this environment");
	}
	const document = new DOMParser().parseFromString(html, "text/html");
	const root = document.querySelector(".mw-parser-output") || document.body;
	const groups = new Map<string, DefinitionSense[]>();
	let currentLanguage = "";

	for (const heading of Array.from(root.querySelectorAll("h2, h3, h4, h5, h6"))) {
		const level = Number(heading.tagName.substring(1));
		const headingText = cleanText(heading.textContent || "");
		if (!headingText) continue;
		if (level === 2) {
			currentLanguage = headingText;
			continue;
		}
		if (!PARTS_OF_SPEECH.has(normalizeHeading(headingText))) continue;

		const senses = extractSensesForHeading(heading, level, headingText);
		if (senses.length === 0) continue;
		const groupName = currentLanguage || term;
		const existing = groups.get(groupName) || [];
		existing.push(...senses);
		groups.set(groupName, existing);
	}

	if (groups.size === 0) {
		const fallbackSenses = extractFallbackSenses(root);
		if (fallbackSenses.length > 0) groups.set(term, fallbackSenses);
	}

	const sourceUrl = `https://${wikiLanguage}.wiktionary.org/wiki/${encodeURIComponent(term.replace(/ /g, "_"))}`;
	return Array.from(groups.entries()).slice(0, limit).map(([entryLanguage, senses], index) => ({
		id: `wiktionary:${wikiLanguage}:${entryLanguage}:${term}`,
		sourceId: "wiktionary",
		word: term,
		language: wikiLanguage,
		entryLanguage: entryLanguage === term ? undefined : entryLanguage,
		aliases: [],
		senses: deduplicateSenses(senses),
		sourceUrl,
		license: "CC BY-SA 4.0",
		score: 1100 - index * 10,
	}));
}

function extractSensesForHeading(
	heading: Element,
	headingLevel: number,
	partOfSpeech: string,
): DefinitionSense[] {
	const senses: DefinitionSense[] = [];
	let cursor: Element | null = getHeadingContainer(heading).nextElementSibling;
	while (cursor) {
		const nextHeading = findHeading(cursor);
		if (nextHeading) {
			const nextLevel = Number(nextHeading.tagName.substring(1));
			if (nextLevel <= headingLevel) break;
		}
		for (const list of getTopLevelOrderedLists(cursor)) {
			senses.push(...extractSensesFromList(list, partOfSpeech));
		}
		cursor = cursor.nextElementSibling;
	}
	return senses;
}

function extractFallbackSenses(root: Element): DefinitionSense[] {
	for (const list of Array.from(root.querySelectorAll("ol"))) {
		if (list.parentElement?.closest("ol") !== null) continue;
		const senses = extractSensesFromList(list);
		if (senses.length > 0) return senses;
	}
	return [];
}

function extractSensesFromList(list: Element, partOfSpeech?: string): DefinitionSense[] {
	const senses: DefinitionSense[] = [];
	for (const child of Array.from(list.children)) {
		if (child.tagName !== "LI") continue;
		const examples = extractExamples(child);
		const clone = child.cloneNode(true) as Element;
		clone.querySelectorAll("ol, ul, dl, table, sup, style, script, .reference, .mw-editsection, .h-usage-example, .e-example")
			.forEach(element => element.remove());
		const definition = cleanText(clone.textContent || "");
		if (!definition) continue;
		senses.push({ definition, partOfSpeech, examples });
	}
	return senses;
}

function extractExamples(listItem: Element): DefinitionExample[] | undefined {
	const values: string[] = [];
	listItem.querySelectorAll(".h-usage-example, .e-example, dl dd").forEach(element => {
		const text = cleanText(element.textContent || "");
		if (text) values.push(text);
	});
	const unique = Array.from(new Set(values)).slice(0, 2);
	return unique.length > 0 ? unique.map(text => ({ text })) : undefined;
}

function getTopLevelOrderedLists(element: Element): Element[] {
	if (element.tagName === "OL") return [element];
	return Array.from(element.querySelectorAll("ol"))
		.filter(list => !list.parentElement?.closest("ol"));
}

function getHeadingContainer(heading: Element): Element {
	const parent = heading.parentElement;
	return parent?.classList.contains("mw-heading") ? parent : heading;
}

function findHeading(element: Element): Element | null {
	if (/^H[2-6]$/.test(element.tagName)) return element;
	if (element.classList.contains("mw-heading")) {
		return element.querySelector("h2, h3, h4, h5, h6");
	}
	return null;
}

function deduplicateSenses(senses: DefinitionSense[]): DefinitionSense[] {
	const seen = new Set<string>();
	return senses.filter(sense => {
		const key = `${sense.partOfSpeech || ""}\n${sense.definition}`.toLocaleLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function normalizeHeading(value: string): string {
	return value
		.replace(/\[(?:edit|编辑|編輯)\]/gi, "")
		.replace(/(?:编辑|編輯)$/g, "")
		.trim()
		.toLocaleLowerCase();
}

function cleanText(value: string): string {
	return value
		.replace(/\[(?:edit|编辑|編輯)\]/gi, "")
		.replace(/\[\d+\]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function deduplicateStrings(values: string[]): string[] {
	const seen = new Set<string>();
	return values.filter(value => {
		const key = normalizeTerm(value);
		if (!key || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function normalizeTerm(value: string): string {
	return value.trim().toLocaleLowerCase();
}

function decodeHtmlAttribute(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

function asRecord(value: unknown): Record<string, any> {
	return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
