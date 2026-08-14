import { App, normalizePath, requestUrl } from "obsidian";

export const ECDICT_VERSION = "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b";
export const ECDICT_SOURCE_URL = `https://raw.githubusercontent.com/skywind3000/ECDICT/${ECDICT_VERSION}/ecdict.csv`;
export const ECDICT_SOURCE_SIZE = 65_933_428;
export const ECDICT_INDEX_SCHEMA_VERSION = 2;

export const ECDICT_PLUGIN_ID = "note-definitions";
const LEGACY_PLUGIN_ID = "obsidian-note-definitions";
const METADATA_FILE = "metadata.json";
const BUFFER_FLUSH_SIZE = 256 * 1024;
const BUCKETS = [
	"other", "0-9",
	..."abcdefghijklmnopqrstuvwxyz".split(""),
] as const;

export interface EcdictEntry {
	word: string;
	phonetic: string;
	translation: string;
	pos: string;
	exchange: string;
	definition: string;
	oxford: string;
	tag: string;
}

export interface EcdictInstallProgress {
	processedBytes: number;
	totalBytes: number;
	entryCount: number;
}

export interface EcdictStoreStatus {
	installed: boolean;
	installing: boolean;
	entryCount?: number;
	version?: string;
}

interface EcdictMetadata {
	version: string;
	sourceUrl: string;
	entryCount: number;
	installedAt: string;
	indexSchemaVersion: number;
}

type StoredEntry = [
	string, string, string, string, string,
	string, string, string,
];

interface BucketBuffer {
	parts: string[];
	size: number;
}

const stores = new WeakMap<App, EcdictStore>();

export function getEcdictStore(app: App): EcdictStore {
	let store = stores.get(app);
	if (!store) {
		store = new EcdictStore(app);
		stores.set(app, store);
	}
	return store;
}

/** Downloads the pinned ECDICT CSV once and converts it to small, lazy-loaded buckets. */
export class EcdictStore {
	private installPromise?: Promise<EcdictMetadata>;
	private progressListeners = new Set<(progress: EcdictInstallProgress) => void>();
	private loadedBucket?: { name: string; entries: Map<string, EcdictEntry> };
	private readonly basePath: string;
	private readonly legacyBasePath: string;
	private migrationPromise?: Promise<void>;

	constructor(private app: App) {
		this.basePath = normalizePath(
			`${app.vault.configDir}/plugins/${ECDICT_PLUGIN_ID}/ecdict`,
		);
		this.legacyBasePath = normalizePath(
			`${app.vault.configDir}/plugins/${LEGACY_PLUGIN_ID}/ecdict`,
		);
	}

	onProgress(listener: (progress: EcdictInstallProgress) => void): () => void {
		this.progressListeners.add(listener);
		return () => this.progressListeners.delete(listener);
	}

	async getStatus(): Promise<EcdictStoreStatus> {
		await this.ensureLegacyCacheMigrated();
		const metadata = await this.readMetadata();
		return {
			installed: metadata?.version === ECDICT_VERSION
				&& metadata?.indexSchemaVersion === ECDICT_INDEX_SCHEMA_VERSION,
			installing: this.installPromise !== undefined,
			entryCount: metadata?.entryCount,
			version: metadata?.version,
		};
	}

	async ensureInstalled(): Promise<void> {
		const status = await this.getStatus();
		if (!status.installed) await this.install(true);
	}

	async install(force = false): Promise<EcdictMetadata> {
		if (this.installPromise) return this.installPromise;
		await this.ensureLegacyCacheMigrated();
		if (!force) {
			const metadata = await this.readMetadata();
			if (metadata?.version === ECDICT_VERSION
				&& metadata?.indexSchemaVersion === ECDICT_INDEX_SCHEMA_VERSION) return metadata;
		}

		this.installPromise = this.installInternal()
			.finally(() => {
				this.installPromise = undefined;
			});
		return this.installPromise;
	}

	async lookup(term: string): Promise<EcdictEntry | undefined> {
		const normalizedTerm = normalizeWord(term);
		if (!normalizedTerm) return undefined;
		await this.ensureInstalled();

		const bucketName = getBucketName(normalizedTerm);
		if (this.loadedBucket?.name !== bucketName) {
			this.loadedBucket = {
				name: bucketName,
				entries: await this.loadBucket(bucketName),
			};
		}
		return this.loadedBucket.entries.get(normalizedTerm);
	}

	private async installInternal(): Promise<EcdictMetadata> {
		const adapter = this.app.vault.adapter;
		if (!await adapter.exists(this.basePath)) {
			await adapter.mkdir(this.basePath);
		}

		// An invalid marker prevents partially generated data from being treated as ready.
		await adapter.write(this.pathFor(METADATA_FILE), JSON.stringify({ version: "installing" }));
		for (const bucket of BUCKETS) {
			await adapter.write(this.bucketPath(bucket), "");
		}

		const buffers = new Map<string, BucketBuffer>();
		let entryCount = 0;
		let processedBytes = 0;
		let pending = "";
		let headerSeen = false;

		const consumeLine = async (rawLine: string): Promise<void> => {
			const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
			if (!line) return;
			if (!headerSeen) {
				headerSeen = true;
				return;
			}
			const entry = parseEcdictCsvLine(line);
			if (!entry?.word) return;
			entryCount++;
			await this.bufferEntry(entry, buffers);
		};

		const consumeText = async (text: string, final = false): Promise<void> => {
			pending += text;
			let start = 0;
			let end = pending.indexOf("\n", start);
			while (end >= 0) {
				await consumeLine(pending.slice(start, end));
				start = end + 1;
				end = pending.indexOf("\n", start);
			}
			pending = pending.slice(start);
			if (final && pending) {
				await consumeLine(pending);
				pending = "";
			}
		};

		try {
			const response = await fetch(ECDICT_SOURCE_URL, {
				headers: { Accept: "text/csv" },
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);

			if (response.body) {
				const reader = response.body.getReader();
				const decoder = new TextDecoder("utf-8");
				while (true) {
					const chunk = await reader.read();
					if (chunk.done) break;
					processedBytes += chunk.value.byteLength;
					await consumeText(decoder.decode(chunk.value, { stream: true }));
					this.emitProgress(processedBytes, entryCount);
				}
				await consumeText(decoder.decode(), true);
			} else {
				const text = await response.text();
				processedBytes = text.length;
				await consumeText(text, true);
			}
		} catch (fetchError) {
			// Obsidian requestUrl is the CORS-independent fallback on restricted clients.
			try {
				buffers.clear();
				entryCount = 0;
				processedBytes = 0;
				pending = "";
				headerSeen = false;
				for (const bucket of BUCKETS) {
					await adapter.write(this.bucketPath(bucket), "");
				}
				const response = await requestUrl({
					url: ECDICT_SOURCE_URL,
					method: "GET",
					headers: { Accept: "text/csv" },
				});
				processedBytes = response.text.length;
				await consumeText(response.text, true);
			} catch (requestError) {
				throw new Error(
					`ECDICT download failed: ${errorMessage(requestError || fetchError)}`,
				);
			}
		}

		await Promise.all(Array.from(buffers.keys()).map(bucket => this.flushBucket(bucket, buffers)));
		this.emitProgress(processedBytes || ECDICT_SOURCE_SIZE, entryCount);

		const metadata: EcdictMetadata = {
			version: ECDICT_VERSION,
			sourceUrl: ECDICT_SOURCE_URL,
			entryCount,
			installedAt: new Date().toISOString(),
			indexSchemaVersion: ECDICT_INDEX_SCHEMA_VERSION,
		};
		await adapter.write(this.pathFor(METADATA_FILE), JSON.stringify(metadata));
		this.loadedBucket = undefined;
		return metadata;
	}

	private async bufferEntry(
		entry: EcdictEntry,
		buffers: Map<string, BucketBuffer>,
	): Promise<void> {
		const bucketName = getBucketName(entry.word);
		let buffer = buffers.get(bucketName);
		if (!buffer) {
			buffer = { parts: [], size: 0 };
			buffers.set(bucketName, buffer);
		}
		const stored: StoredEntry = [
			entry.word,
			entry.phonetic,
			entry.translation,
			entry.pos,
			entry.exchange,
			entry.definition,
			entry.oxford,
			entry.tag,
		];
		const line = `${JSON.stringify(stored)}\n`;
		buffer.parts.push(line);
		buffer.size += line.length;
		if (buffer.size >= BUFFER_FLUSH_SIZE) {
			await this.flushBucket(bucketName, buffers);
		}
	}

	private async flushBucket(
		bucketName: string,
		buffers: Map<string, BucketBuffer>,
	): Promise<void> {
		const buffer = buffers.get(bucketName);
		if (!buffer || buffer.parts.length === 0) return;
		const data = buffer.parts.join("");
		buffer.parts = [];
		buffer.size = 0;
		await this.app.vault.adapter.append(this.bucketPath(bucketName), data);
	}

	private async loadBucket(bucketName: string): Promise<Map<string, EcdictEntry>> {
		const raw = await this.app.vault.adapter.read(this.bucketPath(bucketName));
		const entries = new Map<string, EcdictEntry>();
		for (const line of raw.split("\n")) {
			if (!line) continue;
			try {
				const stored = JSON.parse(line) as StoredEntry;
				if (!Array.isArray(stored) || typeof stored[0] !== "string") continue;
				const entry: EcdictEntry = {
					word: stored[0],
					phonetic: stored[1] || "",
					translation: stored[2] || "",
					pos: stored[3] || "",
					exchange: stored[4] || "",
					definition: stored[5] || "",
					oxford: stored[6] || "",
					tag: stored[7] || "",
				};
				const key = normalizeWord(entry.word);
				if (key && !entries.has(key)) entries.set(key, entry);
			} catch {
				// Ignore a malformed record instead of making the whole bucket unavailable.
			}
		}
		return entries;
	}

	private emitProgress(processedBytes: number, entryCount: number): void {
		const progress = {
			processedBytes,
			totalBytes: ECDICT_SOURCE_SIZE,
			entryCount,
		};
		for (const listener of this.progressListeners) listener(progress);
	}

	private async readMetadata(): Promise<EcdictMetadata | undefined> {
		const path = this.pathFor(METADATA_FILE);
		if (!await this.app.vault.adapter.exists(path)) return undefined;
		try {
			const value = JSON.parse(await this.app.vault.adapter.read(path));
			if (!isRecord(value) || typeof value.version !== "string") return undefined;
			return value as unknown as EcdictMetadata;
		} catch {
			return undefined;
		}
	}

	private async ensureLegacyCacheMigrated(): Promise<void> {
		if (this.migrationPromise) return this.migrationPromise;
		this.migrationPromise = this.migrateLegacyCache();
		return this.migrationPromise;
	}

	private async migrateLegacyCache(): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (await adapter.exists(this.basePath)) return;
		if (!await adapter.exists(this.legacyBasePath)) return;
		try {
			await adapter.rename(this.legacyBasePath, this.basePath);
		} catch (error) {
			console.warn("Failed to migrate the legacy ECDICT cache directory", error);
		}
	}

	private bucketPath(bucketName: string): string {
		return this.pathFor(`${bucketName}.ndjson`);
	}

	private pathFor(fileName: string): string {
		return normalizePath(`${this.basePath}/${fileName}`);
	}
}

export function parseEcdictCsvLine(line: string): EcdictEntry | undefined {
	const fields = parseCsvLine(line);
	if (fields.length < 4 || !fields[0]) return undefined;
	return {
		word: fields[0].replace(/^\uFEFF/, "").trim(),
		phonetic: fields[1]?.trim() || "",
		translation: unescapeEcdictText(fields[3] || "").trim(),
		pos: fields[4]?.trim() || "",
		exchange: fields[10]?.trim() || "",
		definition: unescapeEcdictText(fields[2] || "").trim(),
		oxford: fields[6]?.trim() || "",
		tag: fields[7]?.trim() || "",
	};
}

export function parseCsvLine(line: string): string[] {
	const fields: string[] = [];
	let field = "";
	let quoted = false;
	for (let index = 0; index < line.length; index++) {
		const char = line[index];
		if (char === '"') {
			if (quoted && line[index + 1] === '"') {
				field += '"';
				index++;
			} else {
				quoted = !quoted;
			}
		} else if (char === "," && !quoted) {
			fields.push(field);
			field = "";
		} else {
			field += char;
		}
	}
	fields.push(field);
	return fields;
}

function unescapeEcdictText(value: string): string {
	return value.replace(/\\r\\n|\\n|\\r/g, "\n");
}

function getBucketName(value: string): string {
	const first = normalizeWord(value).charAt(0);
	if (/[a-z]/.test(first)) return first;
	if (/[0-9]/.test(first)) return "0-9";
	return "other";
}

function normalizeWord(value: string): string {
	return value.trim().toLocaleLowerCase();
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
