import { Editor } from "obsidian";
import { EditorView } from "@codemirror/view";
import { definitionMarker } from "src/editor/decoration";

export function getMarkedWordUnderCursor(editor: Editor) {
	// @ts-expect-error - cm is not typed in Obsidian's Editor
	const view = editor.cm as EditorView;
	const plugin = view?.plugin?.(definitionMarker);
	if (!plugin) {
		return "";
	}
	const currWord = getWordByOffset(plugin.getMarkedPhrases(), editor.posToOffset(editor.getCursor()));
	return normaliseWord(currWord);
}

export function normaliseWord(word: string) {
	return word.trimStart().trimEnd().toLowerCase();
}

function getWordByOffset(markedPhrases: { from: number; to: number; phrase: string }[], offset: number): string {
	let start = 0;
	let end = markedPhrases.length - 1;

	// Binary search to get marked word at provided position
	while (start <= end) {
		let mid = Math.floor((start + end) / 2);

		let currPhrase = markedPhrases[mid];
		if (offset >= currPhrase.from && offset <= currPhrase.to) {
			return currPhrase.phrase;
		}
		if (offset < currPhrase.from) {
			end = mid - 1;
		}
		if (offset > currPhrase.to) {
			start = mid + 1;
		}
	}
	return "";
}
