import { BaseDefParser } from "./base-def-parser";
import { App, TFile } from "obsidian";
import { Definition } from "./model";
import { DefFileType } from "./file-type";


export class AtomicDefParser extends BaseDefParser {
	app: App;
	file: TFile;

	constructor(app: App, file: TFile) {
		super();

		this.app = app;
		this.file = file;
	}

	async parseFile(fileContent?: string): Promise<Definition[]> {
		if (!fileContent) {
			fileContent = await this.app.vault.cachedRead(this.file);
		}

		const fileMetadata = this.app.metadataCache.getFileCache(this.file);
		let aliases: string[] = [];
		let bodyStartOffset = 0;

		// Prefer metadata cache for aliases and frontmatter slicing
		const fmData = fileMetadata?.frontmatter;
		if (fmData) {
			const fmAlias = fmData["aliases"];
			if (Array.isArray(fmAlias)) {
				aliases = fmAlias;
			}
		}
		const fmPos = fileMetadata?.frontmatterPosition;
		if (fmPos) {
			bodyStartOffset = fmPos.end.offset + 1;
		} else {
			// Fallback: parse frontmatter from raw content when cache isn't ready
			const parsed = this.parseFrontmatterFromContent(fileContent);
			if (parsed) {
				bodyStartOffset = parsed.bodyOffset;
				if (parsed.aliases.length > 0) {
					aliases = parsed.aliases;
				}
			}
		}

		fileContent = fileContent.slice(bodyStartOffset);

		aliases = aliases.concat(this.calculatePlurals([this.file.basename].concat(aliases)));

		const def = {
			key: this.file.basename.toLowerCase(),
			word: this.file.basename,
			aliases: aliases,
			definition: fileContent,
			file: this.file,
			linkText: `${this.file.path}`,
			fileType: DefFileType.Atomic,
		}
		return [def];
	}

	// Minimal frontmatter parser used only as a fallback when metadata cache is stale
	private parseFrontmatterFromContent(fileContent: string): { aliases: string[], bodyOffset: number } | null {
		const match = fileContent.match(/^---\s*[\r\n]+([\s\S]*?)\r?\n---\s*/);
		if (!match) {
			return null;
		}

		const fmBlock = match[1];
		const aliases: string[] = [];
		let currentKey: string | null = null;

		fmBlock.split(/\r?\n/).forEach(line => {
			const aliasMatch = line.match(/^\s*aliases\s*:\s*(.+)?$/i);
			if (aliasMatch) {
				currentKey = "aliases";
				const inline = aliasMatch[1]?.trim();
				if (inline) {
					aliases.push(...inline.split(",").map(a => a.trim()).filter(Boolean));
				}
				return;
			}

			if (currentKey === "aliases") {
				const listMatch = line.match(/^\s*-\s*(.+)\s*$/);
				if (listMatch && listMatch[1]) {
					aliases.push(listMatch[1].trim());
				} else if (line.trim() !== "") {
					// End of aliases block
					currentKey = null;
				}
			}
		});

		return { aliases, bodyOffset: match[0].length };
	}
}
