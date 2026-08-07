import { normalizeLocale, translate } from "../i18n";

describe("i18n", () => {
	it.each([
		["zh", "zh-CN"],
		["zh-cn", "zh-CN"],
		["zh_TW", "zh-CN"],
		["en-US", "en"],
		["fr", "en"],
		[undefined, "en"]
	])("normalizes %s to a supported locale", (input, expected) => {
		expect(normalizeLocale(input)).toBe(expected);
	});

	it("translates and interpolates dynamic values", () => {
		expect(translate("zh-CN", "Line {{line}}", { line: 12 })).toBe("第 12 行");
		expect(translate("en", "Line {{line}}", { line: 12 })).toBe("Line 12");
	});

	it("keeps unresolved placeholders visible", () => {
		expect(translate("en", "Line {{line}}")).toBe("Line {{line}}");
	});
});
