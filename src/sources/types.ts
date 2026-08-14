export type DefinitionSourceId = "ecdict" | "wikidata" | "wiktionary";

export type DefinitionSourceLanguage = "auto" | "zh" | "en";

export type DefinitionSourceStatus = "planned" | "available";

export interface DefinitionSourceEntryConfig {
	enabled: boolean;
}

export interface EcdictDefinitionSourceConfig extends DefinitionSourceEntryConfig {
	includeEnglishDefinition: boolean;
	vocabularyTagsEnabled: boolean;
	vocabularyTags: EcdictVocabularyTagConfig;
}

export type EcdictVocabularyTag =
	| "oxford3000"
	| "zk"
	| "gk"
	| "cet4"
	| "cet6"
	| "ky"
	| "gre"
	| "toefl"
	| "ielts";

export type EcdictVocabularyTagConfig = Record<EcdictVocabularyTag, boolean>;

export interface DefinitionSourcesConfig {
	preferredLanguage: DefinitionSourceLanguage;
	sources: {
		ecdict: EcdictDefinitionSourceConfig;
		wikidata: DefinitionSourceEntryConfig;
		wiktionary: DefinitionSourceEntryConfig;
	};
}

export interface DefinitionLookupRequest {
	term: string;
	language: DefinitionSourceLanguage;
	context?: string;
	limit?: number;
	sourceConfig?: DefinitionSourceEntryConfig | EcdictDefinitionSourceConfig;
}

export interface DefinitionExample {
	text: string;
	language?: string;
}

export interface DefinitionSense {
	definition: string;
	partOfSpeech?: string;
	examples?: DefinitionExample[];
}

export interface DefinitionPronunciation {
	text: string;
	region?: "uk" | "us";
}

export interface DefinitionWordForm {
	type: string;
	value: string;
}

/**
 * Normalized result shared by every external definition source.
 * A later UI layer can turn a selected candidate into the plugin's Definition model.
 */
export interface DefinitionCandidate {
	id: string;
	sourceId: DefinitionSourceId;
	word: string;
	language: string;
	entryLanguage?: string;
	aliases: string[];
	senses: DefinitionSense[];
	pronunciations?: DefinitionPronunciation[];
	forms?: DefinitionWordForm[];
	englishSenses?: DefinitionSense[];
	oxford3000?: boolean;
	examTags?: string[];
	sourceUrl?: string;
	license?: string;
	score?: number;
}

export interface DefinitionSourceAdapter {
	readonly id: DefinitionSourceId;
	lookup(request: DefinitionLookupRequest): Promise<DefinitionCandidate[]>;
}

export interface DefinitionSourceMetadata {
	id: DefinitionSourceId;
	name: string;
	status: DefinitionSourceStatus;
	homepage: string;
	license: string;
}
