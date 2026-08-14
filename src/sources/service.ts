import { App } from "obsidian";
import { EcdictDefinitionSource } from "./ecdict-adapter";
import { DefinitionSourceRegistry } from "./source-registry";
import { WikidataDefinitionSource } from "./wikidata-adapter";
import { WiktionaryDefinitionSource } from "./wiktionary-adapter";

let registry: DefinitionSourceRegistry | undefined;
let registryApp: App | undefined;

export function getDefinitionSourceRegistry(app?: App): DefinitionSourceRegistry {
	const resolvedApp = app || (typeof window !== "undefined" ? window.NoteDefinition?.app : undefined);
	if (!registry || (resolvedApp && registryApp !== resolvedApp)) {
		registry = new DefinitionSourceRegistry();
		if (resolvedApp) registry.register(new EcdictDefinitionSource(resolvedApp));
		registry.register(new WikidataDefinitionSource());
		registry.register(new WiktionaryDefinitionSource());
		registryApp = resolvedApp;
	}
	return registry;
}
