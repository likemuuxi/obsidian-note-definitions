import { DefinitionCandidate, DefinitionSense } from "./types";

export interface CandidateFormatLabels {
	example: string;
	source: string;
	meaning?: string;
	phonetic?: string;
	englishDefinition?: string;
	vocabularyInfo?: string;
	oxford3000?: string;
}

export function formatDefinitionCandidate(
	candidate: DefinitionCandidate,
	labels: CandidateFormatLabels,
): string {
	if (candidate.sourceId === "ecdict") {
		return formatEcdictCandidate(candidate, labels);
	}
	const sections = formatSenses(candidate.senses, labels.example);
	if (candidate.sourceUrl) {
		sections.push(
			`> [${labels.source}: ${sourceName(candidate.sourceId)}](${candidate.sourceUrl})${candidate.license ? ` · ${candidate.license}` : ""}`
		);
	}
	return sections.join("\n\n").trim();
}

function formatEcdictCandidate(
	candidate: DefinitionCandidate,
	labels: CandidateFormatLabels,
): string {
	const meaningLines: string[] = [`**${labels.meaning || "Meaning"}**`];
	const sections: string[] = [];
	const pronunciations = candidate.pronunciations || [];
	if (pronunciations.length > 0) {
		const phoneticLabel = labels.phonetic || "Phonetic";
		const separator = /[\u3400-\u9fff]/.test(phoneticLabel) ? "：" : ":";
		const values = pronunciations.map(pronunciation => {
			const region = pronunciation.region ? `${pronunciation.region.toUpperCase()} ` : "";
			return `${region}/${pronunciation.text}/`;
		});
		meaningLines.push(`- ${phoneticLabel}${separator}${values.join("; ")}`);
	}
	for (const sense of candidate.senses) {
		const pos = sense.partOfSpeech?.trim();
		meaningLines.push(pos
			? `- \`${pos}\` ${sense.definition}`
			: `- ${sense.definition}`);
	}
	sections.push(meaningLines.join("\n"));

	const vocabularyTags: string[] = [];
	if (candidate.oxford3000) {
		vocabularyTags.push(`#${(labels.oxford3000 || "Oxford 3000").replace(/\s+/g, "")}`);
	}
	if (candidate.examTags && candidate.examTags.length > 0) {
		const vocabularyLabel = labels.vocabularyInfo || "Vocabulary information";
		const chinese = /[\u3400-\u9fff]/.test(vocabularyLabel);
		vocabularyTags.push(...candidate.examTags
			.map(tag => `#${formatEcdictExamTag(tag, chinese).replace(/\s+/g, chinese ? "" : "-")}`));
	}
	if (vocabularyTags.length > 0) {
		sections.push([
			`**${labels.vocabularyInfo || "Vocabulary information"}**`,
			`- ${vocabularyTags.join(" ")}`,
		].join("\n"));
	}

	if (candidate.englishSenses && candidate.englishSenses.length > 0) {
		const englishLines = [`**${labels.englishDefinition || "English definition"}**`];
		const groupedSenses = new Map<string, DefinitionSense[]>();
		for (const sense of candidate.englishSenses) {
			const pos = sense.partOfSpeech?.trim() || "";
			const group = groupedSenses.get(pos) || [];
			group.push(sense);
			groupedSenses.set(pos, group);
		}
		groupedSenses.forEach((senses, pos) => {
			if (!pos) {
				senses.forEach(sense => englishLines.push(`- ${sense.definition}`));
				return;
			}
			englishLines.push(`- \`${pos}\``);
			senses.forEach(sense => englishLines.push(`    - ${sense.definition}`));
		});
		sections.push(englishLines.join("\n"));
	}

	return sections.join("\n\n").trim();
}

export function formatEcdictExamTag(tag: string, chinese: boolean): string {
	const normalized = tag.trim().toLocaleLowerCase();
	const common: Record<string, string> = {
		cet4: "CET-4",
		cet6: "CET-6",
		gre: "GRE",
		toefl: "TOEFL",
		ielts: "IELTS",
	};
	if (common[normalized]) return common[normalized];
	const localized: Record<string, [string, string]> = {
		zk: ["中考", "Junior high school"],
		gk: ["高考", "Gaokao"],
		ky: ["考研", "Postgraduate entrance exam"],
	};
	const value = localized[normalized];
	return value ? value[chinese ? 0 : 1] : tag.toUpperCase();
}

function formatSenses(senses: DefinitionSense[], exampleLabel: string): string[] {
	if (senses.length === 0) return [];
	if (senses.length === 1) {
		const sense = senses[0];
		const parts = [sense.partOfSpeech ? `**${sense.partOfSpeech}**` : "", sense.definition]
			.filter(Boolean);
		appendExamples(parts, sense, exampleLabel);
		return [parts.join("\n\n")];
	}

	const groups = new Map<string, DefinitionSense[]>();
	for (const sense of senses) {
		const key = sense.partOfSpeech || "";
		const group = groups.get(key) || [];
		group.push(sense);
		groups.set(key, group);
	}

	const output: string[] = [];
	groups.forEach((group, partOfSpeech) => {
		const lines: string[] = [];
		if (partOfSpeech) lines.push(`### ${partOfSpeech}`, "");
		group.forEach((sense, index) => {
			lines.push(`${index + 1}. ${sense.definition}`);
			for (const example of sense.examples || []) {
				lines.push(`   - *${exampleLabel}:* ${example.text}`);
			}
		});
		output.push(lines.join("\n"));
	});
	return output;
}

function appendExamples(parts: string[], sense: DefinitionSense, exampleLabel: string): void {
	for (const example of sense.examples || []) {
		parts.push(`> **${exampleLabel}:** ${example.text}`);
	}
}

function sourceName(sourceId: DefinitionCandidate["sourceId"]): string {
	if (sourceId === "ecdict") return "ECDICT";
	return sourceId === "wikidata" ? "Wikidata" : "Wiktionary";
}
