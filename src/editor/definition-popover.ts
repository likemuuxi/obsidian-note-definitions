import { App, Component, MarkdownRenderer, MarkdownView, normalizePath, Plugin } from "obsidian";
import { Definition } from "src/core/model";
import { getSettings, PopoverDismissType } from "src/settings";
import { logDebug, logError } from "src/util/log";

const DEF_POPOVER_ID = "definition-popover";

let definitionPopover: DefinitionPopover;

interface Coordinates {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export class DefinitionPopover extends Component {
	app: App
	plugin: Plugin;
	// Code mirror editor object for capturing vim events
	cmEditor: any;
	// Ref to the currently mounted popover
	// There should only be one mounted popover at all times
	mountedPopover: HTMLElement | undefined;

	constructor(plugin: Plugin) {
		super();
		this.app = plugin.app;
		this.plugin = plugin;
		this.cmEditor = this.getCmEditor(this.app);
	}

	// Open at editor cursor's position
	openAtCursor(def: Definition) {
		this.unmount();
		this.mountAtCursor(def);

		if (!this.mountedPopover) {
			logError("Mounting definition popover failed");
			return
		}

		this.registerClosePopoverListeners();
	}

	// Open at coordinates (can use for opening at mouse position)
	openAtCoords(def: Definition, coords: Coordinates) {
		this.unmount();
		this.mountAtCoordinates(def, coords);

		if (!this.mountedPopover) {
			logError("mounting definition popover failed");
			return
		}
		this.registerClosePopoverListeners();
	}

	cleanUp() {
		logDebug("Cleaning popover elements");
		const popoverEls = document.getElementsByClassName(DEF_POPOVER_ID);
		for (let i = 0; i < popoverEls.length; i++) {
			popoverEls[i].remove();
		}
	}

	close = () => {
		this.unmount();
	}

	clickClose = () => {
		if (this.mountedPopover?.matches(":hover")) {
			return;
		}
		this.close();
	}

	private getCmEditor(app: App) {
		const activeView = app.workspace.getActiveViewOfType(MarkdownView);
		const cmEditor = (activeView as any)?.editMode?.editor?.cm?.cm;
		if (!cmEditor) {
			logDebug("cmEditor object not found, will not handle vim events for definition popover");
		}
		return cmEditor;
	}

	private shouldOpenToLeft(horizontalOffset: number, containerWidth: number): boolean {
		return horizontalOffset > containerWidth / 2;
	}

	private shouldOpenUpwards(verticalOffset: number, containerHeight: number): boolean {
		return verticalOffset > containerHeight / 2;
	}

	// Creates popover element and its children, without displaying it 
	private createElement(def: Definition, parent: HTMLElement): HTMLDivElement {
		const popoverSettings = getSettings().defPopoverConfig;
		const el = parent.createEl("div", {
			cls: "definition-popover",
			attr: {
				id: DEF_POPOVER_ID,
				style: `visibility:hidden;${popoverSettings.backgroundColour ? 
`background-color: ${popoverSettings.backgroundColour};` : ''}`
			},
		});

		const header = el.createDiv({ cls: "definition-popover-header" });
		header.createEl("div", { cls: "definition-popover-word", text: def.word });

		if (def.aliases.length > 0 && popoverSettings.displayAliases) {
			header.createDiv({
				cls: "definition-popover-alias-text",
				text: def.aliases.join(", ")
			});
		}

		const contentEl = el.createEl("div", { cls: "definition-popover-body" });
		contentEl.setAttr("ctx", "def-popup");

		const currComponent = this;
		MarkdownRenderer.render(this.app, def.definition, contentEl, 
			normalizePath(def.file.path), currComponent);
		this.postprocessMarkdown(contentEl, def);

		if (popoverSettings.displayDefFileName) {
			el.createEl("div", {
				text: def.file.basename,
				cls: 'definition-popover-filename'
			});
		}
		return el;
	}

	// Internal links do not work properly in the popover
	// This is to manually open internal links
	private postprocessMarkdown(el: HTMLDivElement, def: Definition) {
		const internalLinks = el.getElementsByClassName("internal-link");
		for (let i = 0; i < internalLinks.length; i++) {
			const linkEl = internalLinks.item(i);
			if (linkEl) {
				linkEl.addEventListener('click', e => {
					e.preventDefault();
					const file = this.app.metadataCache.getFirstLinkpathDest(linkEl.getAttr("href") ?? '', 
						normalizePath(def.file.path))
					this.unmount();
					if (!file) {
						return;
					}
					this.app.workspace.getLeaf().openFile(file)
				});
			}
		}
	}

	private mountAtCursor(def: Definition) {
		let cursorCoords;
		try {
			cursorCoords = this.getCursorCoords();
		} catch (e) {
			logError("Could not open definition popover - could not get cursor coordinates");
			return
		}

		this.mountAtCoordinates(def, cursorCoords);
	}

	// Offset coordinates from viewport coordinates to coordinates relative to the parent container element
	private mountAtCoordinates(def: Definition, coords: Coordinates) {
		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView)
		if (!mdView) {
			logError("Could not mount popover: No active markdown view found");
			return;
		}

		this.mountedPopover = this.createElement(def, document.body);
		this.positionAndSizePopover(mdView, coords);
	}

	// Position and display popover
	private positionAndSizePopover(mdView: MarkdownView, coords: Coordinates) {
		if (!this.mountedPopover) {
			return;
		}
		const popoverSettings = getSettings().defPopoverConfig;
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;

		const positionStyle: Partial<CSSStyleDeclaration> = {
			visibility: 'visible',
		};

		const useCustomSize = popoverSettings.enableCustomSize;
		if (useCustomSize && popoverSettings.maxWidth) {
			positionStyle.maxWidth = `${popoverSettings.maxWidth}px`;
		}

		if (this.shouldOpenToLeft(coords.left, viewportWidth)) {
			positionStyle.right = `${viewportWidth - coords.right}px`;
		} else {
			positionStyle.left = `${coords.left}px`;
		}

		if (this.shouldOpenUpwards(coords.top, viewportHeight)) {
			positionStyle.bottom = `${viewportHeight - coords.top}px`;
			if (useCustomSize && popoverSettings.maxHeight) {
				positionStyle.maxHeight = `${popoverSettings.maxHeight}px`;
			}
		} else {
			positionStyle.top = `${coords.bottom}px`;
			if (useCustomSize && popoverSettings.maxHeight) {
				positionStyle.maxHeight = `${popoverSettings.maxHeight}px`;
			}
		}

		this.mountedPopover.setCssStyles(positionStyle);
	}

	private unmount() {
		if (!this.mountedPopover) {
			logDebug("Nothing to unmount, could not find popover element");
			return
		}
		this.mountedPopover.remove();
		this.mountedPopover = undefined;

		this.unregisterClosePopoverListeners();
	}

	// This uses internal non-exposed codemirror API to get cursor coordinates
	// Cursor coordinates seem to be relative to viewport
	private getCursorCoords(): Coordinates {
		const editor = this.app.workspace.activeEditor?.editor;
		// @ts-ignore
		return editor?.cm?.coordsAtPos(editor?.posToOffset(editor?.getCursor()), -1);
	}

	private registerClosePopoverListeners() {
		this.getActiveView()?.containerEl.addEventListener("keypress", this.close);
		this.getActiveView()?.containerEl.addEventListener("click", this.clickClose);
		
		if (this.mountedPopover) {
			this.mountedPopover.addEventListener("mouseleave", () => {
				const popoverSettings = getSettings().defPopoverConfig;
				if (popoverSettings.popoverDismissEvent === PopoverDismissType.MouseExit) {
					this.clickClose();
				}
			});
		}
		if (this.cmEditor) {
			this.cmEditor.on("vim-keypress", this.close);
		}
		const scroller = this.getCmScroller();
		if (scroller) {
			scroller.addEventListener("scroll", this.close);
		}
	}

	private unregisterClosePopoverListeners() {
		this.getActiveView()?.containerEl.removeEventListener("keypress", this.close);
		this.getActiveView()?.containerEl.removeEventListener("click", this.clickClose);

		if (this.cmEditor) {
			this.cmEditor.off("vim-keypress", this.close);
		}
		const scroller = this.getCmScroller();
		if (scroller) {
			scroller.removeEventListener("scroll", this.close);
		}
	}

	private getCmScroller() {
		const scroller = document.getElementsByClassName("cm-scroller");
		if (scroller.length > 0) {
			return scroller[0];
		}
	}

	getPopoverElement() {
		return document.getElementById("definition-popover");
	}

	private getActiveView() {
		return this.app.workspace.getActiveViewOfType(MarkdownView);
	}
}

// Mount definition popover
export function initDefinitionPopover(plugin: Plugin) {
	if (definitionPopover) {
		definitionPopover.cleanUp();
	}
	definitionPopover = new DefinitionPopover(plugin);
}

export function getDefinitionPopover() {
	return definitionPopover;
}
