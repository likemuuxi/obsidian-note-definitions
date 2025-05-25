# 更新记录

## AI功能增强

### 移除简单别名生成
- 移除了基于规则的简单别名生成功能
- 现在完全依赖AI生成别名，当AI功能未启用时返回空数组
- 更新了相关UI提示信息

### AI别名生成优化
- 简化了AI别名生成逻辑，移除复杂的Wikipedia风格解析
- 直接让AI返回逗号分隔的别名列表
- 减少了token限制从150降至100以提高效率
- 优化了别名清理和过滤逻辑

### 自定义AI提示词功能
- 在`AIConfig`接口中添加了`customAliasPrompt`字段
- 创建了设置UI，包含自定义别名提示词的文本区域和重置按钮
- 修改了`generateAliasPrompt()`方法支持{word}占位符替换
- 更新了默认设置以包含完整的别名提示词模板
- 增强了`getAIConfig()`方法以加载自定义别名提示词

### Prompt映射功能
- 完善了prompt映射系统，支持分别设置定义和别名prompt：
  - 恢复了单独的别名prompt映射（`folderAliasPromptMap`和`fileAliasPromptMap`）
  - 现在支持四种类型的映射：
    - `folderPromptMap`: 文件夹路径到定义prompt的映射（atomic类型）
    - `filePromptMap`: 文件路径到定义prompt的映射（consolidated类型）
    - `folderAliasPromptMap`: 文件夹路径到别名prompt的映射（atomic类型）
    - `fileAliasPromptMap`: 文件路径到别名prompt的映射（consolidated类型）
- 在设置页面保留了两个管理按钮：
  - "Folder Prompt Mapping (Atomic)": 管理atomic类型的文件夹映射
  - "File Prompt Mapping (Consolidated)": 管理consolidated类型的文件映射
- 增强了映射管理UI：
  - 添加映射时可以同时设置定义prompt和别名prompt
  - 映射列表显示定义prompt和别名prompt的预览
  - 编辑映射时可以分别修改定义prompt和别名prompt
  - 改进了映射项的显示布局，更清晰地展示两种prompt
- 映射管理界面特性：
  - 垂直布局显示每个映射项，包含路径、定义prompt预览和别名prompt预览
  - 支持编辑和删除现有映射
  - 添加映射时从下拉框选择文件夹或文件
  - 支持多行文本输入自定义定义prompt和别名prompt
  - 实时保存到插件设置

### AI按钮增强功能
- 在Add Definition模态框的AI按钮旁边添加了设置图标（⚙️）
- 设置按钮功能：
  - 显示当前选择的文件类型和路径信息
  - 实时预览当前生效的定义prompt和别名prompt
  - 支持直接编辑和保存当前路径的prompt映射
  - 提供"重置为默认"按钮，快速恢复到默认prompt
  - 提供"管理映射"按钮，快速跳转到插件设置页面
- 设置模态框特性：
  - 清晰显示当前文件类型（Atomic/Consolidated）和目标路径
  - 分别显示定义生成prompt和别名生成prompt的文本区域
  - 支持实时编辑prompt内容
  - 一键保存映射到当前选择的路径
  - 友好的用户界面和操作提示

### AI服务映射支持
- 完善了`AIService`类中的映射支持：
  - `getMappedPrompt(fileType, path)`: 根据文件类型和路径获取映射的定义prompt
  - `getMappedAliasPrompt(fileType, path)`: 根据文件类型和路径获取映射的别名prompt（使用专门的别名映射）
- 修改了`generatePrompt()`和`generateAliasPrompt()`方法，添加可选的fileType和path参数
- 更新了`generateDefinition()`和`generateAliases()`公共方法，支持传递映射参数
- 映射逻辑：
  - 定义生成：优先使用`folderPromptMap`或`filePromptMap`中的映射，回退到`customPrompt`
  - 别名生成：优先使用`folderAliasPromptMap`或`fileAliasPromptMap`中的映射，回退到`customAliasPrompt`
  - 支持{word}占位符替换功能

### Add Modal集成
- 修改了`AddDefinitionModal`中的AI按钮点击事件
- 自动获取当前选择的文件类型（atomic/consolidated）
- 根据文件类型获取对应的路径：
  - atomic类型：使用文件夹路径（移除末尾斜杠）
  - consolidated类型：使用文件路径
- 将文件类型和路径信息传递给AI服务进行prompt映射
- 确保AI生成时使用最合适的prompt
- 新增设置按钮提供即时的prompt管理功能

### AI代码架构重构
- 创建了新的`src/core/ai-service.ts`文件
- 将所有AI相关功能从`add-modal.ts`中分离出来
- 实现了`AIService`类，包含：
  - `generateDefinition(word: string)`: 生成定义
  - `generateAliases(word: string)`: 生成别名
  - `updateConfig(config: AIConfig)`: 更新配置
  - `aiConfig` getter: 访问配置信息
- 支持OpenAI、Google Gemini、Ollama、自定义API等多种提供商
- 完整的错误处理和响应解析逻辑
- 重构了`add-modal.ts`，移除了所有AI相关方法
- 更新了AI按钮事件处理器使用新的AIService
- 移除了不再需要的`requestUrl`导入

## 文件夹组织功能

### Atomic模式的子文件夹系统
- 增强了现有的"Add file to folder"下拉框
- 修改了`atomicFolderPickerSetting`以扫描和显示所有现有子文件夹
- 添加了递归文件夹检测逻辑以发现多级目录结构
- 在下拉框末尾添加了"+ Create new subfolder"选项

### 模态框式子文件夹创建
- 实现了`createNewSubfolder()`方法，使用自定义Modal界面
- 创建了专业的输入对话框，包含文本字段和创建/取消按钮
- 添加了键盘快捷键支持（Enter/Escape）
- 使用临时文件创建/删除技术在Obsidian中创建文件夹
- 添加了`refreshFolderDropdown()`方法在创建后更新选项
- 实现了验证逻辑防止在选择"+ Create new subfolder"时保存
- 创建成功后自动选择新创建的文件夹

### Consolidated类型的子文件夹功能
- 添加了`consolidatedSubfolderPickerSetting`和`consolidatedSubfolderPicker`
- 创建了显示DefFolders及其子文件夹的子文件夹选择器
- 在Definition file下拉框旁添加了"+"按钮用于创建新文件
- 实现了`createNewDefFile()`方法，使用模态界面
- 添加了`refreshDefFileDropdown()`方法以按选定子文件夹过滤文件

### 文件类型过滤
- 修改了`refreshDefFileDropdown()`以仅显示具有`def-type: consolidated`属性的文件
- 增强了文件夹匹配逻辑以处理DefFolders和子文件夹
- 修复了子文件夹中文件的匹配问题
- 添加了精确的文件夹匹配，支持直接父文件夹和子文件夹层次结构

### 文件创建和缓存更新
- 解决了新创建文件不立即出现在下拉框中的问题
- 实现了手动文件注册和解析方法：
  - 创建带有适当`def-type: consolidated` frontmatter的文件
  - 使用`defManager.addDefFile(newFile)`注册文件
  - 等待300ms让metadata cache更新
  - 使用`FileParser`手动解析文件
  - 如果类型匹配则添加到`consolidatedDefFiles`集合
  - 刷新下拉框显示新文件

## 删除定义功能

### DefFileUpdater删除方法
- 添加了`deleteDefinition(def: Definition)`方法，支持删除atomic和consolidated类型的定义
- 实现了`deleteAtomicDefFile(def: Definition)`：
  - 直接删除整个文件（atomic类型一个文件只包含一个定义）
  - 从DefManager中移除文件引用
- 实现了`deleteConsolidatedDefFile(def: Definition)`：
  - 解析文件内容找到要删除的定义
  - 使用`removeDefinition`方法移除指定位置的定义
  - 智能处理分割符（如果删除的定义后面有分割符，也会一并删除）
- 添加了`removeDefinition(position: FilePosition, lines: string[])`方法：
  - 根据定义的位置信息删除相应的行
  - 智能处理分割符：检查设置中启用的分割符类型（dash `---` 或 underscore `___`）
  - 如果删除定义后紧跟分割符，会一并删除分割符和空行

### DefManager文件移除方法
- 添加了`removeDefFile(file: TFile)`方法：
  - 从全局文件映射中移除文件
  - 从consolidated文件映射中移除文件
  - 清理该文件的所有定义数据

### 右键菜单删除功能
- 在`registerMenuForMarkedWords`方法中添加了"Delete definition"菜单项
- 使用垃圾桶图标，点击时显示确认对话框
- 实现了`showDeleteConfirmation(def: Definition)`确认对话框：
  - 显示要删除的定义名称
  - 根据定义类型显示不同的警告信息
  - Atomic类型：提示将删除整个文件
  - Consolidated类型：提示将从文件中删除此定义
  - 提供"取消"和"删除"按钮，删除按钮使用警告样式

### 智能分割符处理
- 系统根据设置中配置的分割符类型来处理删除
- 支持dash（`---`）和underscore（`___`）分割符
- 删除定义时检查后续行是否为分割符
- 如果是分割符，会一并删除以保持文件格式整洁
- 同时移除多余的空行

## 重要修复

### Frontmatter偏移问题修复
- 修复了删除consolidated文件中第一个定义时的内容错位问题
- 问题原因：ConsolidatedDefParser解析时跳过frontmatter，但删除时使用完整文件行号
- 在`deleteConsolidatedDefFile`和`updateConsolidatedDefFile`方法中添加了frontmatter偏移计算：
  - 使用`app.metadataCache.getFileCache(file)`获取frontmatter位置信息
  - 基于frontmatter的结束位置计算行数偏移
  - 将解析器记录的相对位置调整为绝对位置
  - 对没有frontmatter的文件，偏移量为0，不影响原有逻辑
- 确保了删除和编辑操作都能正确定位到目标内容

## 技术改进

### 代码结构优化
- 关注点分离：AI逻辑与UI逻辑完全分离
- 可重用性：AIService可以在其他地方使用
- 可维护性：AI相关的修改只需要在一个文件中进行
- 类型安全：保持了完整的TypeScript类型检查
- 映射系统：提供了灵活的prompt定制能力

### 错误处理增强
- 完整的文件操作错误处理
- 定义查找失败时的错误处理
- 操作成功后的确认通知
- AI功能的连接测试和错误反馈
- 映射配置的验证和保存

### 用户体验改进
- 专业的模态对话框界面
- 键盘导航支持
- 清晰的验证消息和用户反馈
- 自动刷新和状态更新
- 智能的文件夹和文件管理
- 灵活的prompt映射系统
- 直观的映射管理界面 