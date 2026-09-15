# WebUI redesign proposal

## 定位

将现有 WebUI 重设计为中性的 AI 工作台，保留现有聊天、会话、项目、Agents、Apps、Skills、Automations、Settings 和 Workbench 能力，但移除原开源项目的品牌识别。

## 视觉方向

- 移除 Nanobot 名称、Logo、mark、狐狸图形和相关品牌文案。
- 移除橙色主题、橙色高亮和橙色状态提示。
- 使用中性炭黑/灰白界面，单一冷青色作为产品强调色；绿色、黄色、红色仅用于成功、警告、错误状态。
- 保持工具型产品气质：内容优先、低装饰、少阴影、少边框，避免卡片堆叠。
- 主字体统一为系统无衬线字体，代码和数据使用等宽字体。

## 布局

### 桌面端

- 左侧导航宽度约 240px，包含新建、搜索、Chats、Agents、Tools、Settings。
- 中间为主要工作区，聊天默认占据最大宽度。
- 右侧上下文面板按需打开，用于文件预览、会话信息、Agent 活动和 Workspace 详情。
- 保留 Workbench 多窗格，但增加 Focus mode，并突出当前 Pane 和运行状态。

### 移动端

- 左侧导航改为 Sheet。
- Apps、Skills、Automations 收入 Tools。
- 右侧上下文面板改为全屏 Sheet。
- 多窗格改为 Tab 切换，不强制并排。

## 关键页面

### Chat

- 空状态显示当前 Workspace 和可执行的三项快捷任务，不使用品牌口号。
- 消息区采用文档流布局，减少传统气泡感。
- Tool activity 和 Agent activity 作为可折叠时间线显示。
- Composer 分为输入区和上下文工具栏；文件、命令、Workspace、Model 为高频入口，其余操作收入 `+` 菜单。

### Sidebar

- 一级入口：New chat、Search。
- 工作区入口：Chats、Agents、Tools。
- 系统入口：Settings、连接状态。
- 会话按 Pinned、Today、Projects、Archived 分组。

### Tools

Apps、Skills、Automations 使用“搜索/筛选 + 列表 + 详情面板”，不使用三列等高卡片。

列表项显示名称、说明、状态、最近使用时间和行内操作；详情面板显示权限、配置、可用命令和运行记录。

### Settings

分为四组：

- General：Overview、Appearance、Language、Shortcuts
- Models & Capabilities：Models、Image、Voice、Browser
- Connections：Channels、Apps、Integrations
- Runtime & Security：Workspace、Runtime、Security、Advanced

每个分组顶部显示当前配置摘要；需要重启的配置显示统一的 pending restart 状态。

## 实施顺序

1. 清理品牌元素和橙色主题 token。
2. 重做颜色、字体、按钮、输入框、列表状态。
3. 调整 Chat Header、空状态和 Composer。
4. 重组 Sidebar 和 Workbench 视觉层级。
5. 重做 Tools 和 Settings 的信息架构。
6. 完善移动端、loading、empty、error 和 focus 状态。

## 约束

- 不迁移 React、Tailwind、shadcn/ui 或现有协议。
- 不改动 WebSocket、会话持久化、文件预览和核心业务逻辑。
- 设计改动优先集中在 `webui/src` 的布局组件、主题 token 和样式层。
- 新品牌名称、Logo 和强调色待确定后再加入，当前保持无品牌占位设计。
