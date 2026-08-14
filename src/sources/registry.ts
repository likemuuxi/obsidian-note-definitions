import {
	DefinitionSourceId,
	DefinitionSourceMetadata,
	DefinitionSourcesConfig,
	EcdictVocabularyTag,
} from "./types";

export const DEFINITION_SOURCES: readonly DefinitionSourceMetadata[] = [
	{
		id: "ecdict",
		name: "ECDICT",
		status: "available",
		homepage: "https://github.com/skywind3000/ECDICT",
		license: "MIT",
	},
	{
		id: "wikidata",
		name: "Wikidata",
		status: "available",
		homepage: "https://www.wikidata.org/",
		license: "CC0 1.0",
	},
	{
		id: "wiktionary",
		name: "Wiktionary",
		status: "available",
		homepage: "https://www.wiktionary.org/",
		license: "CC BY-SA 4.0",
	},
] as const;

export const DEFAULT_DEFINITION_SOURCES_CONFIG: DefinitionSourcesConfig = {
	preferredLanguage: "auto",
	sources: {
			ecdict: {
				enabled: true,
				includeEnglishDefinition: false,
				vocabularyTagsEnabled: true,
				vocabularyTags: {
				oxford3000: false,
				zk: false,
				gk: false,
				cet4: false,
				cet6: false,
				ky: false,
				gre: false,
				toefl: false,
				ielts: false,
			},
		},
		wikidata: { enabled: false },
		wiktionary: { enabled: false },
	},
};

const SOURCE_IDS = new Set<DefinitionSourceId>(DEFINITION_SOURCES.map(source => source.id));
const ECDICT_VOCABULARY_TAGS: EcdictVocabularyTag[] = [
	"oxford3000", "zk", "gk", "cet4", "cet6", "ky", "gre", "toefl", "ielts",
];

export function createDefaultDefinitionSourcesConfig(): DefinitionSourcesConfig {
	return {
		preferredLanguage: DEFAULT_DEFINITION_SOURCES_CONFIG.preferredLanguage,
		sources: {
			ecdict: {
				...DEFAULT_DEFINITION_SOURCES_CONFIG.sources.ecdict,
				vocabularyTags: {
					...DEFAULT_DEFINITION_SOURCES_CONFIG.sources.ecdict.vocabularyTags,
				},
			},
			wikidata: { ...DEFAULT_DEFINITION_SOURCES_CONFIG.sources.wikidata },
			wiktionary: { ...DEFAULT_DEFINITION_SOURCES_CONFIG.sources.wiktionary },
		},
	};
}

export function normalizeDefinitionSourcesConfig(value: unknown): DefinitionSourcesConfig {
	const defaults = createDefaultDefinitionSourcesConfig();
	if (!isRecord(value)) return defaults;

	const preferredLanguage = value.preferredLanguage;
	if (preferredLanguage === "auto" || preferredLanguage === "zh" || preferredLanguage === "en") {
		defaults.preferredLanguage = preferredLanguage;
	}

	if (!isRecord(value.sources)) return defaults;

	for (const sourceId of SOURCE_IDS) {
		const sourceValue = value.sources[sourceId];
		if (isRecord(sourceValue) && typeof sourceValue.enabled === "boolean") {
			defaults.sources[sourceId].enabled = sourceValue.enabled;
		}
	}

	const ecdictValue = value.sources.ecdict;
	if (isRecord(ecdictValue)) {
		if (typeof ecdictValue.includeEnglishDefinition === "boolean") {
			defaults.sources.ecdict.includeEnglishDefinition = ecdictValue.includeEnglishDefinition;
		}
		if (typeof ecdictValue.vocabularyTagsEnabled === "boolean") {
			defaults.sources.ecdict.vocabularyTagsEnabled = ecdictValue.vocabularyTagsEnabled;
		}

		if (isRecord(ecdictValue.vocabularyTags)) {
			for (const tag of ECDICT_VOCABULARY_TAGS) {
				if (typeof ecdictValue.vocabularyTags[tag] === "boolean") {
					defaults.sources.ecdict.vocabularyTags[tag] = ecdictValue.vocabularyTags[tag];
				}
			}
		} else {
			// Migrate the earlier all-or-nothing Oxford and exam tag switches.
			if (ecdictValue.includeOxford3000 === true) {
				defaults.sources.ecdict.vocabularyTags.oxford3000 = true;
			}
			if (ecdictValue.includeExamTags === true) {
				for (const tag of ECDICT_VOCABULARY_TAGS) {
					if (tag !== "oxford3000") defaults.sources.ecdict.vocabularyTags[tag] = true;
				}
			}
		}
	}

	return defaults;
}

export function getDefinitionSourceMetadata(id: DefinitionSourceId): DefinitionSourceMetadata {
	const source = DEFINITION_SOURCES.find(item => item.id === id);
	if (!source) {
		throw new Error(`Unknown definition source: ${id}`);
	}
	return source;
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
