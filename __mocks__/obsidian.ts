
export class App { }

export class TFile {}

export class PluginSettingTab {}

export class Modal {
	constructor(app: any) {}
}

export class Notice {
	constructor(message: string, timeout?: number) {}
}

export class Setting {
	constructor(containerEl: any) {}
	setName(name: string) { return this; }
	setDesc(desc: string) { return this; }
	addText(cb: (text: any) => any) { return this; }
	addButton(cb: (btn: any) => any) { return this; }
	addExtraButton(cb: (btn: any) => any) { return this; }
}

export class TextComponent {
	inputEl: any = {};
	constructor(containerEl: any) {}
	setPlaceholder(p: string) { return this; }
	setValue(v: string) { return this; }
	setDisabled(d: boolean) { return this; }
	getValue() { return ""; }
	onChange(cb: (v: string) => void) { return this; }
}

export function setIcon(el: any, icon: string) {}
