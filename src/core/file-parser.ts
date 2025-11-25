import { App, TFile } from "obsidian";
import { AtomicDefParser } from "./atomic-def-parser";
import { ConsolidatedDefParser } from "./consolidated-def-parser";
import { DefFileType } from "./file-type";
import { Definition } from "./model";

export const DEF_TYPE_FM = "def-type";

export class FileParser {
	app: App;
	file: TFile;
	defFileType?: DefFileType;

	constructor(app: App, file: TFile) {
		this.app = app;
		this.file = file;
	}

	// Optional argument used when file cache may not be updated
	// and we know the new contents of the file
	async parseFile(fileContent?: string): Promise<Definition[]> {
		if (!fileContent) {
			fileContent = await this.app.vault.cachedRead(this.file);
		}

		this.defFileType = this.getDefFileType(fileContent);

		// 如果文件没有明确的def-type属性，跳过处理
		if (!this.defFileType) {
			return [];
		}

		switch (this.defFileType) {
			case DefFileType.Consolidated: {
				const defParser = new ConsolidatedDefParser(this.app, this.file);
				return defParser.parseFile(fileContent);
			}
			case DefFileType.Atomic: {
				const atomicParser = new AtomicDefParser(this.app, this.file);
				return atomicParser.parseFile(fileContent);
			}
			default:
				return [];
		}
	}

	private getDefFileType(fileContent?: string): DefFileType | undefined {
		const fileCache = this.app.metadataCache.getFileCache(this.file);
		const fmFileType = fileCache?.frontmatter?.[DEF_TYPE_FM];
		if (fmFileType &&
			(fmFileType === DefFileType.Consolidated || fmFileType === DefFileType.Atomic)) {
			return fmFileType;
		}

		// Frontmatter cache might not be ready; fall back to scanning file content
		if (fileContent) {
			const fmMatch = fileContent.match(/^---\s*[\r\n]+([\s\S]*?)\r?\n---/);
			if (fmMatch && fmMatch[1]) {
				const lines = fmMatch[1].split(/\r?\n/);
				for (const line of lines) {
					const match = line.match(/^\s*def-type\s*:\s*(.+)\s*$/i);
					if (match) {
						const raw = match[1].trim().toLowerCase();
						if (raw === DefFileType.Consolidated || raw === "consolidated") {
							return DefFileType.Consolidated;
						}
						if (raw === DefFileType.Atomic || raw === "atomic") {
							return DefFileType.Atomic;
						}
					}
				}
			}
		}

		return undefined;
	}
}
