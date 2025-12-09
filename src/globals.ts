import { App, Platform } from "obsidian";
import { DefinitionRepo, getDefFileManager } from "./core/def-file-manager";
import { getDefinitionPopover } from "./editor/definition-popover";
import { getDefinitionModal } from "./editor/mobile/definition-modal";
import { getSettings, PopoverDismissType, Settings } from "./settings";
import { LogLevel } from "./util/log";

export {}

declare global {
	interface Window { NoteDefinition: GlobalVars; }
}

export interface GlobalVars {
	LOG_LEVEL: LogLevel;
	definitions: {
		global: DefinitionRepo;
	};
	triggerDefPreview: (el: HTMLElement) => void;
	settings: Settings;
	app: App;
}

// Initialise and inject globals
export function injectGlobals(settings: Settings, app: App, targetWindow: Window) {
	targetWindow.NoteDefinition = {
		app: app,
		LOG_LEVEL: activeWindow.NoteDefinition?.LOG_LEVEL || LogLevel.Error,
		definitions: {
			global: new DefinitionRepo(),
		},
		triggerDefPreview: (el: HTMLElement) => {
			const word = el.getAttr('def');
			if (!word) return;

			const def = getDefFileManager().get(word);
			if (!def) return;

			const defPopover = getDefinitionPopover();
			let isOpen = false;

			if (Platform.isMobile) {
				const centerCoords = {
					left: window.innerWidth / 2,
					right: window.innerWidth / 2,
					top: window.innerHeight / 2,
					bottom: window.innerHeight / 2,
				};
				defPopover.openAtCoords(def, centerCoords as any, { center: true });
				return;
			}

			if (el.onmouseenter) {
				const openPopover = setTimeout(() => {
					defPopover.openAtCoords(def, el.getBoundingClientRect());
					isOpen = true;
				}, 200);

				el.onmouseleave = () => {
					const popoverSettings = getSettings().defPopoverConfig;
					if (!isOpen) {
						clearTimeout(openPopover);
					} else if (popoverSettings.popoverDismissEvent === PopoverDismissType.MouseExit) {
						defPopover.clickClose();
					}
				}
				return;
			}
			defPopover.openAtCoords(def, el.getBoundingClientRect());
		},
		settings,
	}
}
