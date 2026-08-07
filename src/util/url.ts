/**
 * Normalize a base URL by trimming whitespace, removing trailing /v1 and
 * excess slashes, and ensuring an http(s) scheme prefix.
 */
export function normalizeBaseUrl(url: string): string {
	url = url.trim();
	url = url.replace(/\/v1\/?$/, "");   // remove trailing /v1
	url = url.replace(/\/+$/, "");       // remove trailing slashes
	if (!/^https?:\/\//i.test(url)) {
		url = "https://" + url;
	}
	return url;
}
