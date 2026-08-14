import {
	DefinitionCandidate,
	EcdictDefinitionSource,
	findWiktionaryCanonicalTerm,
	formatDefinitionCandidate,
	parseEcdictCsvLine,
	parseEcdictExamTags,
	parseEcdictExchange,
	parseEcdictTranslation,
	WikidataDefinitionSource,
	WiktionaryDefinitionSource,
} from "../sources";

describe("ECDICT definition source", () => {
	test("parses the CSV fields used by the local index", () => {
		const entry = parseEcdictCsvLine(
			'abacus,ˈæbəkəs,,"n. 算盘, 算板",n:100,1,,,0,0,s:abacuses,,',
		);

		expect(entry).toEqual({
			word: "abacus",
			phonetic: "ˈæbəkəs",
			translation: "n. 算盘, 算板",
			pos: "n:100",
			exchange: "s:abacuses",
			definition: "",
			oxford: "",
			tag: "",
		});
	});

	test("normalizes Chinese senses and documented word forms", () => {
		expect(parseEcdictTranslation("n. 算盘\n[网络] 珠算", "n:100"))
			.toEqual([{ definition: "算盘", partOfSpeech: "n" }]);
		expect(parseEcdictExchange("s:abacuses/0:abacus"))
			.toEqual([
				{ type: "word_pl", value: "abacuses" },
				{ type: "word_lemma", value: "abacus" },
			]);
	});

	test("returns a candidate with pronunciation, aliases, senses, and forms", async () => {
		const source = new EcdictDefinitionSource(async () => ({
			word: "abacus",
			phonetic: "'æbәkәs",
			translation: "n. 算盘",
			pos: "n:100",
			exchange: "",
			definition: "n. a device used for arithmetic",
			oxford: "1",
			tag: "cet4 gre",
		}));

		const candidates = await source.lookup({
			term: "abacus",
			language: "zh",
			sourceConfig: {
				enabled: true,
				includeEnglishDefinition: true,
				vocabularyTagsEnabled: true,
				vocabularyTags: {
					oxford3000: true,
					zk: false,
					gk: false,
					cet4: true,
					cet6: false,
					ky: false,
					gre: false,
					toefl: false,
					ielts: false,
				},
			},
		});

		expect(candidates).toHaveLength(1);
		expect(candidates[0].aliases).toEqual(["abacuses"]);
		expect(candidates[0].pronunciations).toEqual([{ text: "ˈæbəkəs" }]);
		expect(candidates[0].senses).toEqual([{ definition: "算盘", partOfSpeech: "n" }]);
		expect(candidates[0].forms).toEqual([{ type: "word_pl", value: "abacuses" }]);
		expect(candidates[0].englishSenses).toEqual([{
			definition: "a device used for arithmetic",
			partOfSpeech: "n",
		}]);
		expect(candidates[0].oxford3000).toBe(true);
		expect(candidates[0].examTags).toEqual(["cet4"]);
	});

	test("parses and deduplicates exam tags", () => {
		expect(parseEcdictExamTags("cet4 GRE cet4")).toEqual(["cet4", "GRE"]);
	});
});

describe("Wikidata definition source", () => {
	test("searches entities and combines Chinese and English labels and aliases", async () => {
		const requestJson = jest.fn()
			.mockResolvedValueOnce({
				search: [{
					id: "Q2539",
					label: "机器学习",
					description: "人工智能领域",
					concepturi: "https://www.wikidata.org/entity/Q2539",
					match: { text: "机器学习" },
				}],
			})
			.mockResolvedValueOnce({
				entities: {
					Q2539: {
						labels: {
							zh: { language: "zh", value: "机器学习" },
							en: { language: "en", value: "machine learning" },
						},
						descriptions: {
							zh: { language: "zh", value: "人工智能中的一个研究领域" },
							en: { language: "en", value: "field of study in artificial intelligence" },
						},
						aliases: {
							zh: [{ language: "zh", value: "机器学习技术" }],
							en: [{ language: "en", value: "ML" }],
						},
					},
				},
			});
		const source = new WikidataDefinitionSource(requestJson);

		const candidates = await source.lookup({ term: "机器学习", language: "zh" });

		expect(candidates).toHaveLength(1);
		expect(candidates[0].word).toBe("机器学习");
		expect(candidates[0].aliases).toEqual(expect.arrayContaining([
			"machine learning",
			"机器学习技术",
			"ML",
		]));
		expect(candidates[0].senses[0].definition).toBe("人工智能中的一个研究领域");
		expect(requestJson.mock.calls[0][0]).toContain("action=wbsearchentities");
		expect(requestJson.mock.calls[1][0]).toContain("action=wbgetentities");
	});

	test("returns an empty list when search has no matches", async () => {
		const requestJson = jest.fn().mockResolvedValue({ search: [] });
		const source = new WikidataDefinitionSource(requestJson);

		await expect(source.lookup({ term: "missing", language: "en" }))
			.resolves.toEqual([]);
		expect(requestJson).toHaveBeenCalledTimes(1);
	});
});

describe("Wiktionary definition source", () => {
	test("requests the selected language wiki and passes HTML to the parser", async () => {
		const candidate: DefinitionCandidate = {
			id: "wiktionary:zh:汉语:定义",
			sourceId: "wiktionary",
			word: "定义",
			language: "zh",
			entryLanguage: "汉语",
			aliases: [],
			senses: [{ definition: "对概念的明确说明", partOfSpeech: "名词" }],
		};
		const requestJson = jest.fn().mockResolvedValue({ parse: { text: "<div>content</div>" } });
		const parser = jest.fn().mockReturnValue([candidate]);
		const source = new WiktionaryDefinitionSource(requestJson, parser);

		const result = await source.lookup({ term: "定义", language: "zh", limit: 4 });

		expect(result).toEqual([candidate]);
		expect(requestJson.mock.calls[0][0]).toContain("zh.wiktionary.org");
		expect(requestJson.mock.calls[0][0]).toContain("action=parse");
		expect(parser).toHaveBeenCalledWith("<div>content</div>", "定义", "zh", 4);
	});

	test("treats a missing page as no candidates", async () => {
		const requestJson = jest.fn().mockResolvedValue({
			error: { code: "missingtitle", info: "The page does not exist" },
		});
		const source = new WiktionaryDefinitionSource(requestJson, jest.fn());

		await expect(source.lookup({ term: "missing", language: "en" }))
			.resolves.toEqual([]);
	});

	test("falls back to the other Wiktionary language when the preferred wiki has no page", async () => {
		const requestJson = jest.fn()
			.mockResolvedValueOnce({ error: { code: "missingtitle" } })
			.mockResolvedValueOnce({ parse: { text: "<div>English definition</div>" } });
		const parser = jest.fn().mockReturnValue([{
			id: "wiktionary:en:English:machine learning",
			sourceId: "wiktionary",
			word: "machine learning",
			language: "en",
			aliases: [],
			senses: [{ definition: "A field of artificial intelligence." }],
		}]);
		const source = new WiktionaryDefinitionSource(requestJson, parser);

		const result = await source.lookup({ term: "machine learning", language: "zh" });

		expect(requestJson.mock.calls[0][0]).toContain("zh.wiktionary.org");
		expect(requestJson.mock.calls[1][0]).toContain("en.wiktionary.org");
		expect(parser).toHaveBeenCalledWith("<div>English definition</div>", "machine learning", "en", 6);
		expect(result).toHaveLength(1);
	});

	test("follows Chinese simplified-form references to the canonical entry", async () => {
		const referenceHtml = '<table class="wikitable zh-see"><span class="Hant"><a title="蘋果">蘋果</a></span></table>';
		const requestJson = jest.fn()
			.mockResolvedValueOnce({ parse: { text: referenceHtml } })
			.mockResolvedValueOnce({ parse: { text: "<div>canonical</div>" } });
		const parser = jest.fn().mockReturnValue([{
			id: "wiktionary:zh:漢語:蘋果",
			sourceId: "wiktionary",
			word: "蘋果",
			language: "zh",
			aliases: [],
			senses: [{ definition: "苹果树的果实", partOfSpeech: "名詞" }],
		}]);
		const source = new WiktionaryDefinitionSource(requestJson, parser);

		const result = await source.lookup({ term: "苹果", language: "zh" });

		expect(requestJson).toHaveBeenCalledTimes(2);
		expect(parser).toHaveBeenCalledWith("<div>canonical</div>", "蘋果", "zh", 6);
		expect(result[0].aliases).toContain("苹果");
	});

	test("extracts canonical Chinese references without requiring a DOM", () => {
		const html = '<table class="wikitable zh-see"><span class="Hant"><a title="蘋果">蘋果</a></span></table>';
		expect(findWiktionaryCanonicalTerm(html, "zh")).toBe("蘋果");
	});
});

describe("definition candidate formatting", () => {
	test("formats an ECDICT entry using the compact dictionary template", () => {
		const result = formatDefinitionCandidate({
			id: "ecdict:abacus",
			sourceId: "ecdict",
			word: "abacus",
			language: "zh",
			aliases: ["abacuses"],
			senses: [
				{ definition: "碗, 木球, 大酒杯", partOfSpeech: "n" },
				{ definition: "滚木球, 快而稳地行驶", partOfSpeech: "v" },
			],
			pronunciations: [{ text: "ˈæbəkəs" }],
			forms: [{ type: "word_pl", value: "abacuses" }],
			englishSenses: [{
				definition: "a device used for arithmetic",
				partOfSpeech: "n",
			}],
			oxford3000: true,
			examTags: ["cet4", "gre"],
			sourceUrl: "https://github.com/skywind3000/ECDICT",
			license: "MIT",
		}, {
			example: "例句",
			source: "来源",
			meaning: "词义",
			phonetic: "音标",
			englishDefinition: "英文释义",
			vocabularyInfo: "词汇信息",
			oxford3000: "牛津 3000",
		});

		expect(result).toContain("**词义**");
		expect(result).toContain("- 音标：/ˈæbəkəs/");
		expect(result).toContain("- `n` 碗, 木球, 大酒杯");
		expect(result).toContain("- `v` 滚木球, 快而稳地行驶");
		expect(result).not.toContain("形态");
		expect(result).not.toContain("abacuses");
		expect(result).not.toContain("来源: ECDICT");
		expect(result).not.toContain("github.com/skywind3000/ECDICT");
		expect(result).toContain("**英文释义**");
		expect(result).toContain("- `n`\n    - a device used for arithmetic");
		expect(result).toContain("**词汇信息**");
		expect(result).toContain("- #牛津3000 #CET-4 #GRE");
	});

	test("formats senses, examples, source attribution, and license as Markdown", () => {
		const result = formatDefinitionCandidate({
			id: "test",
			sourceId: "wiktionary",
			word: "test",
			language: "en",
			aliases: [],
			senses: [{
				definition: "A procedure for checking something.",
				partOfSpeech: "Noun",
				examples: [{ text: "The test passed." }],
			}],
			sourceUrl: "https://en.wiktionary.org/wiki/test",
			license: "CC BY-SA 4.0",
		}, { example: "Example", source: "Source" });

		expect(result).toContain("**Noun**");
		expect(result).toContain("> **Example:** The test passed.");
		expect(result).toContain("[Source: Wiktionary]");
		expect(result).toContain("CC BY-SA 4.0");
		expect(result).not.toContain("\n---\n");
	});
});
