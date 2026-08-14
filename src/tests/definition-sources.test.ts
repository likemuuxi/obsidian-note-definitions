import {
	createDefaultDefinitionSourcesConfig,
	DefinitionCandidate,
	DefinitionSourceAdapter,
	DefinitionSourceRegistry,
	normalizeDefinitionSourcesConfig,
} from "../sources";

describe("definition source configuration", () => {
	test("creates independent default configurations", () => {
		const first = createDefaultDefinitionSourcesConfig();
		const second = createDefaultDefinitionSourcesConfig();

		first.sources.wikidata.enabled = true;
		first.sources.ecdict.vocabularyTags.gk = true;

		expect(second.sources.wikidata.enabled).toBe(false);
		expect(second.sources.ecdict.vocabularyTags.gk).toBe(false);
	});

	test("normalizes persisted values and keeps defaults for missing sources", () => {
		const config = normalizeDefinitionSourcesConfig({
			preferredLanguage: "zh",
			sources: {
				wikidata: { enabled: false },
			},
		});

		expect(config.preferredLanguage).toBe("zh");
		expect(config.sources.wikidata.enabled).toBe(false);
		expect(config.sources.ecdict.enabled).toBe(true);
		expect(config.sources.ecdict.includeEnglishDefinition).toBe(false);
		expect(config.sources.ecdict.vocabularyTagsEnabled).toBe(true);
		expect(Object.values(config.sources.ecdict.vocabularyTags).every(enabled => !enabled))
			.toBe(true);
		expect(config.sources.wiktionary.enabled).toBe(false);
	});

	test("normalizes independently selected ECDICT vocabulary tags", () => {
		const config = normalizeDefinitionSourcesConfig({
			sources: {
				ecdict: {
					enabled: true,
					includeEnglishDefinition: true,
					vocabularyTagsEnabled: true,
					vocabularyTags: {
						oxford3000: true,
						gk: true,
						cet4: true,
					},
				},
			},
		});

		expect(config.sources.ecdict.includeEnglishDefinition).toBe(true);
		expect(config.sources.ecdict.vocabularyTagsEnabled).toBe(true);
		expect(config.sources.ecdict.vocabularyTags.oxford3000).toBe(true);
		expect(config.sources.ecdict.vocabularyTags.gk).toBe(true);
		expect(config.sources.ecdict.vocabularyTags.cet4).toBe(true);
		expect(config.sources.ecdict.vocabularyTags.cet6).toBe(false);
		expect(config.sources.ecdict.vocabularyTags.gre).toBe(false);
	});

	test("migrates the earlier combined vocabulary tag switches", () => {
		const config = normalizeDefinitionSourcesConfig({
			sources: {
				ecdict: {
					includeOxford3000: true,
					includeExamTags: true,
				},
			},
		});

		expect(config.sources.ecdict.vocabularyTags.oxford3000).toBe(true);
		expect(config.sources.ecdict.vocabularyTags.zk).toBe(true);
		expect(config.sources.ecdict.vocabularyTags.ielts).toBe(true);
	});

	test("rejects unsupported persisted values", () => {
		const config = normalizeDefinitionSourcesConfig({
			preferredLanguage: "fr",
			sources: {
				wikidata: { enabled: "yes" },
			},
		});

		expect(config.preferredLanguage).toBe("auto");
		expect(config.sources.ecdict.enabled).toBe(true);
		expect(config.sources.wikidata.enabled).toBe(false);
	});
});

describe("definition source registry", () => {
	test("queries enabled adapters, combines scores, and isolates failures", async () => {
		const registry = new DefinitionSourceRegistry();
		registry.register(createAdapter("wikidata", [{
			id: "Q1",
			sourceId: "wikidata",
			word: "test",
			language: "en",
			aliases: [],
			senses: [],
			score: 10,
		}]));
		registry.register({
			id: "wiktionary",
			lookup: async () => {
				throw new Error("unavailable");
			},
		});

		const result = await registry.lookup(
			{ term: "test", language: "en" },
			{
				preferredLanguage: "en",
				sources: {
					ecdict: {
						enabled: false,
						includeEnglishDefinition: false,
						vocabularyTagsEnabled: false,
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
					wikidata: { enabled: true },
					wiktionary: { enabled: true },
				},
			},
		);

		expect(result.candidates.map(candidate => candidate.id)).toEqual(["Q1"]);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0].sourceId).toBe("wiktionary");
	});

	test("does not call a disabled adapter", async () => {
		const registry = new DefinitionSourceRegistry();
		const lookup = jest.fn(async () => [] as DefinitionCandidate[]);
		registry.register({ id: "wikidata", lookup });
		const config = createDefaultDefinitionSourcesConfig();
		config.sources.wikidata.enabled = false;

		await registry.lookup({ term: "test", language: "auto" }, config);

		expect(lookup).not.toHaveBeenCalled();
	});
});

function createAdapter(
	id: DefinitionSourceAdapter["id"],
	candidates: DefinitionCandidate[],
): DefinitionSourceAdapter {
	return {
		id,
		lookup: async () => candidates,
	};
}
