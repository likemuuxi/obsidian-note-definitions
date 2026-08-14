import {
	DefinitionCandidate,
	DefinitionLookupRequest,
	DefinitionSourceAdapter,
	DefinitionSourceId,
	DefinitionSourcesConfig,
} from "./types";

export interface DefinitionSourceFailure {
	sourceId: DefinitionSourceId;
	error: Error;
}

export interface DefinitionLookupResult {
	candidates: DefinitionCandidate[];
	failures: DefinitionSourceFailure[];
}

/** Coordinates source adapters while keeping provider-specific formats out of the UI. */
export class DefinitionSourceRegistry {
	private adapters = new Map<DefinitionSourceId, DefinitionSourceAdapter>();

	register(adapter: DefinitionSourceAdapter): void {
		this.adapters.set(adapter.id, adapter);
	}

	unregister(sourceId: DefinitionSourceId): void {
		this.adapters.delete(sourceId);
	}

	get(sourceId: DefinitionSourceId): DefinitionSourceAdapter | undefined {
		return this.adapters.get(sourceId);
	}

	getAvailableSourceIds(): DefinitionSourceId[] {
		return Array.from(this.adapters.keys());
	}

	async lookup(
		request: DefinitionLookupRequest,
		config: DefinitionSourcesConfig,
	): Promise<DefinitionLookupResult> {
		const enabledAdapters = Array.from(this.adapters.values())
			.filter(adapter => config.sources[adapter.id]?.enabled);

		const results = await Promise.all(enabledAdapters.map(async adapter => {
			try {
				const candidates = await adapter.lookup({
					...request,
					sourceConfig: config.sources[adapter.id],
				});
				return { candidates, failure: undefined };
			} catch (error) {
				return {
					candidates: [] as DefinitionCandidate[],
					failure: {
						sourceId: adapter.id,
						error: toError(error),
					},
				};
			}
		}));

		const candidates = results
			.reduce<DefinitionCandidate[]>((all, result) => all.concat(result.candidates), [])
			.sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
		const failures = results
			.map(result => result.failure)
			.filter((failure): failure is DefinitionSourceFailure => failure !== undefined);

		return { candidates, failures };
	}
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
