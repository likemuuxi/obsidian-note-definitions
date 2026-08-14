import { requestUrl } from "obsidian";

export type DefinitionSourceHttpClient = (url: string) => Promise<unknown>;

const USER_AGENT = "obsidian-note-definitions/1.0.9 (https://github.com/likemuuxi/obsidian-note-definitions)";

export const requestDefinitionSourceJson: DefinitionSourceHttpClient = async (url: string) => {
	const response = await requestUrl({
		url,
		method: "GET",
		headers: {
			Accept: "application/json",
			"User-Agent": USER_AGENT,
			"Api-User-Agent": USER_AGENT,
		},
	});
	return response.json;
};
