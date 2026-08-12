import { App, Modal, Notice, Setting, TextComponent, setIcon } from "obsidian";
import { t } from "../i18n";

/** 仅显示 def- 前缀的密钥 */
const SECRET_PREFIX = "def-";

/**
 * 编辑 / 新增密钥的模态框。
 * 新增时 key 为 null，编辑时 key 为已有密钥 ID。
 */
class EditSecretModal extends Modal {
	constructor(
		app: App,
		private existingKey: string | null,
		private onSave: (key: string, value: string) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle(this.existingKey ? t("Edit secret") : t("Add secret"));

		let nameInput: TextComponent;
		let valueInput: TextComponent;

		// 密钥 ID
		new Setting(contentEl)
			.setName(t("Secret ID"))
			.setDesc(this.existingKey
				? this.existingKey
				: t("Lowercase letters, numbers and dashes only"))
			.addText(text => {
				nameInput = text;
				text.setPlaceholder("my-api-key");
				if (this.existingKey) {
					// 编辑模式：显示去掉 def- 前缀的名称，设为只读
					text.setValue(this.existingKey!.startsWith(SECRET_PREFIX)
						? this.existingKey!.slice(SECRET_PREFIX.length)
						: this.existingKey!);
					text.setDisabled(true);
				} else {
					text.onChange(v => {
						// 仅允许小写字母、数字、破折号
						const cleaned = v.toLowerCase().replace(/[^a-z0-9-]/g, '');
						if (cleaned !== v) text.setValue(cleaned);
					});
				}
			});

		// 密钥值
		new Setting(contentEl)
			.setName(t("Secret value"))
			.setDesc(t("Enter your secret value"))
			.addText(text => {
				valueInput = text;
				text.inputEl.type = 'password';
				text.setPlaceholder("sk-...");
				if (this.existingKey) {
					const stored = this.app.secretStorage.getSecret(this.existingKey);
					if (stored) text.setValue(stored);
				}
			})
			.addExtraButton(btn => {
				btn.setIcon("eye");
				btn.setTooltip(t("Show/hide"));
				let visible = false;
				btn.onClick(() => {
					visible = !visible;
					valueInput.inputEl.type = visible ? 'text' : 'password';
					btn.setIcon(visible ? "eye-off" : "eye");
				});
			});

		// 按钮
		new Setting(contentEl)
			.addButton(btn => {
				btn.setButtonText(t("Cancel"));
				btn.onClick(() => this.close());
			})
			.addButton(btn => {
				btn.setButtonText(t("Save"));
				btn.setCta();
				btn.onClick(() => {
					if (!valueInput) return;
					const value = valueInput.getValue().trim();
					if (!value) { new Notice(t("Please enter a secret value")); return; }

					if (this.existingKey) {
						this.onSave(this.existingKey, value);
					} else {
						const name = nameInput!.getValue().trim();
						if (!name) { new Notice(t("Please enter a secret name")); return; }
						const fullKey = name.startsWith(SECRET_PREFIX) ? name : SECRET_PREFIX + name;
						this.onSave(fullKey, value);
					}
					this.close();
				});
			});
	}
}

/** 密钥选择模态框 —— 列出 def- 前缀的密钥，支持搜索 / 新增 / 编辑 / 删除 */
export class SecretSelectionModal extends Modal {
	private secrets: string[] = [];
	private searchQuery = "";
	private selectedKey: string | null = null;
	private listContainer!: HTMLElement;

	constructor(
		app: App,
		private initialValue: string | null,
		private onSelect: (key: string, value: string) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// 标题
		contentEl.createEl("h2", { text: t("Select secret") });

		// 搜索栏
		const searchContainer = contentEl.createDiv();
		searchContainer.style.display = "flex";
		searchContainer.style.alignItems = "center";
		searchContainer.style.gap = "6px";
		searchContainer.style.marginBottom = "12px";

		const searchIcon = searchContainer.createDiv();
		setIcon(searchIcon, "search");
		const searchInput = searchContainer.createEl("input", {
			type: "text",
			attr: { placeholder: t("Search secrets...") }
		});
		searchInput.style.flex = "1";
		searchInput.oninput = () => {
			this.searchQuery = searchInput.value.toLowerCase();
			this.renderList();
		};

		// 列表容器
		this.listContainer = contentEl.createDiv();
		this.listContainer.style.maxHeight = "350px";
		this.listContainer.style.overflowY = "auto";

		// 底部按钮
		const footer = contentEl.createDiv();
		footer.style.display = "flex";
		footer.style.justifyContent = "space-between";
		footer.style.marginTop = "16px";

		// 左侧：添加密钥
		const addBtn = footer.createEl("button", { text: t("Add secret...") });
		addBtn.onclick = () => {
			new EditSecretModal(this.app, null, (key, value) => {
				this.app.secretStorage.setSecret(key, value);
				this.selectedKey = key;
				this.loadSecrets();
				this.renderList();
			}).open();
		};

		// 右侧：取消 / 保存
		const rightDiv = footer.createDiv();
		rightDiv.style.display = "flex";
		rightDiv.style.gap = "8px";

		const cancelBtn = rightDiv.createEl("button", { text: t("Cancel") });
		cancelBtn.onclick = () => this.close();

		const saveBtn = rightDiv.createEl("button", { text: t("Save") });
		saveBtn.addClass("mod-cta");
		saveBtn.onclick = () => {
			if (this.selectedKey) {
				const val = this.app.secretStorage.getSecret(this.selectedKey) ?? '';
				this.onSelect(this.selectedKey, val);
				this.close();
			} else {
				new Notice(t("Please select a secret first"));
			}
		};

		this.loadSecrets();
		this.renderList();
	}

	private loadSecrets() {
		const all = this.app.secretStorage.listSecrets();
		// 过滤掉 def- 前缀且值为空的密钥（删除后遗留的空壳）
		this.secrets = (all || []).filter(k =>
			k.startsWith(SECRET_PREFIX) && (this.app.secretStorage.getSecret(k) ?? '').length > 0
		);

		// 尝试匹配初始值
		if (this.initialValue && !this.selectedKey) {
			this.selectedKey = this.initialValue;
		}
	}

	private renderList() {
		this.listContainer.empty();

		const filtered = this.secrets.filter(k => k.toLowerCase().includes(this.searchQuery));

		if (filtered.length === 0) {
			const empty = this.listContainer.createDiv({ text: t("No secrets found") });
			empty.style.color = "var(--text-muted)";
			empty.style.textAlign = "center";
			empty.style.padding = "20px";
			return;
		}

		filtered.forEach(key => {
			const isSelected = this.selectedKey === key;
			const item = this.listContainer.createDiv();
			item.style.display = "flex";
			item.style.justifyContent = "space-between";
			item.style.alignItems = "center";
			item.style.padding = "8px 10px";
			item.style.borderRadius = "6px";
			item.style.marginBottom = "4px";
			item.style.cursor = "pointer";
			item.style.background = isSelected
				? "var(--background-modifier-accent)"
				: "var(--background-secondary)";

			// 左侧：选择区
			const left = item.createDiv();
			left.style.display = "flex";
			left.style.alignItems = "center";
			left.style.gap = "8px";
			left.style.flex = "1";
			left.onclick = () => {
				this.selectedKey = key;
				this.renderList();
			};

			// 选中状态指示器
			const indicator = left.createDiv();
			indicator.style.width = "18px";
			indicator.style.height = "18px";
			indicator.style.flexShrink = "0";
			indicator.style.display = "flex";
			indicator.style.alignItems = "center";
			indicator.style.justifyContent = "center";
			if (isSelected) {
				setIcon(indicator, "check-circle");
				indicator.style.color = "var(--interactive-accent)";
			}

			// 密钥名（去掉 def- 前缀显示更友好）
			const displayName = key.startsWith(SECRET_PREFIX) ? key.slice(SECRET_PREFIX.length) : key;
			left.createSpan({ text: displayName });

			if (isSelected) {
				left.createSpan({ text: ` · ${t("Selected")}` });
			}

			// 右侧操作
			const actions = item.createDiv();
			actions.style.display = "flex";
			actions.style.alignItems = "center";
			actions.style.gap = "6px";

			// 编辑
			const editBtn = actions.createEl("button");
			setIcon(editBtn, "pencil");
			this.styleIconBtn(editBtn);
			editBtn.onclick = (e) => {
				e.stopPropagation();
				new EditSecretModal(this.app, key, (k, value) => {
					this.app.secretStorage.setSecret(k, value);
					this.loadSecrets();
					this.renderList();
				}).open();
			};

			// 删除
			const trashBtn = actions.createEl("button");
			setIcon(trashBtn, "trash-2");
			this.styleIconBtn(trashBtn);
			trashBtn.onclick = (e) => {
				e.stopPropagation();
				this.app.secretStorage.setSecret(key, '');
				if (this.selectedKey === key) this.selectedKey = null;
				this.loadSecrets();
				this.renderList();
			};
		});
	}

	private styleIconBtn(btn: HTMLElement) {
		btn.style.padding = "4px";
		btn.style.background = "transparent";
		btn.style.border = "none";
		btn.style.cursor = "pointer";
		btn.style.boxShadow = "none";
		btn.style.color = "var(--text-muted)";
	}

	onClose() {
		this.contentEl.empty();
	}
}
