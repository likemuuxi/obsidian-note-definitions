import { DefinitionManagerView } from "src/editor/definition-manager-view";
import { ViewMode } from "src/settings";

export const DEFINITION_SIDEBAR_VIEW_TYPE = "definition-sidebar-view";

export class DefinitionSidebarView extends DefinitionManagerView {
	protected managerOnly = true;

	// 复制 Definition Manager 的渲染逻辑，便于在侧边栏进行定制
	protected render() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("def-manager-view-container");

		// 侧边栏只展示管理器内容
		this.currentViewMode = ViewMode.Manager;
		this.browseMode = 'flashcard';

		this.createManagerToolbar(container);
		this.createDefinitionList(container);
	}

	getViewType() {
		return DEFINITION_SIDEBAR_VIEW_TYPE;
	}

	getDisplayText() {
		return "Definition Manager";
	}

	getIcon() {
		return "star-list";
	}
}
