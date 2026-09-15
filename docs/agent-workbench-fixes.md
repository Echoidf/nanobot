# Agent 工作台修复规划：i18n 适配 + 侧边栏入口去重

## 1. 问题清单

### 问题 1：agents 页面未做中英文多语言适配

`webui/src/components/agents/AgentWorkbenchView.tsx` 全部文案为硬编码英文，未接入 i18n：

- 页面级：`Agent Workbench`、`Agents`、`Choose an agent profile, inspect its prompt bindings and capabilities, then start a chat with that profile.`、`Refresh`
- 列表级：`Agent List`、`No agents are configured.`、`No description provided.`
- 详情级：`Profile`、`Agent ID`、`Model Preset`、`Skills`、`Tools`、`Capability Summary`、`Recent Chats`、`New Chat With Agent`、`This agent uses the default Nanobot runtime profile.`
- 状态级：`Ready`、`Needs attention`、`Disabled`、`Available`、`Blocked`、`Restricted tools`
- 空态/告警：`This agent does not bind extra skills.`、`Missing skills: ...`、`Disabled skills: ...`、`This agent can use the default tool set.`、`Missing tools: ...`、`No recent chats for this agent.`、`No agent profile is available.`、`Untitled chat`、`No preview yet.`

同时 `Sidebar.tsx` 新增的 Agent 相关文案也只是 `defaultValue` 兜底，locale 文件里没有正式 key（中文界面会显示英文）：

- `sidebar.agents`（AgentPanel 标题 + 动作按钮，当前缺 key）
- `sidebar.agentUnavailable`（"Agent unavailable"）
- `sidebar.defaultModel`（"Default model"）

### 问题 2：侧边栏出现两个 Agent 入口，违反产品设计规范

当前侧边栏结构（`webui/src/components/Sidebar.tsx`）：

```
New Chat / Search / Agents / Apps / Skills / Automations   ← 动作区（新增了 Agents 按钮）
── AGENTS 联系人面板 ──                                      ← 动作区下方（AgentPanel）
└─ 会话列表 ChatList
```

两个入口都指向同一个 `/agents` 页面（`AgentWorkbenchView`）：

| 入口 | 触发 | 行为 |
|---|---|---|
| 动作区 `Agents` 按钮（`onOpenAgents`） | 点击 | `navigate({view:"agents", agentId: selectedAgentId})` |
| `AgentPanel` 联系人（`onSelectAgent`） | 点击头像 | `navigate({view:"agents", agentId})` |

问题点：
1. **重复入口**：同一个目标页面有两个导航入口，用户无法区分差异；
2. **位置混乱**：`Agents` 按钮被插入到 `Search` 与 `Apps` 之间，动作区语义（工具类：Apps/Skills/Automations）被破坏；
3. **违背设计**：`docs/agent-workbench.md` §6 明确"将现有聊天入口旁增加 Agent **联系人列表**"，联系人式 AgentPanel 才是设计形态，独立菜单按钮是多余实现。

## 2. 修复方案

### 方案 A（推荐）：移除动作区 `Agents` 按钮，保留 AgentPanel 联系人入口

符合 `docs/agent-workbench.md` 的"联系人式"设计；侧边栏动作区恢复为 `New Chat / Search / Apps / Skills / Automations` 的原始语义。

**改动点：**

1. `webui/src/components/Sidebar.tsx`
   - 删除动作区中的 `SidebarActionButton`（`onOpenAgents`、`activeUtility === "agents"` 相关按钮）；
   - `SidebarProps` 删除 `onOpenAgents` 字段；
   - `activeUtility` 类型还原为 `"apps" | "skills" | "automations" | null`；
   - 保留 `AgentPanel` 及其 `agents` / `selectedAgentId` / `onSelectAgent` props。

2. `webui/src/App.tsx`
   - 删除 `onOpenAgents` 回调定义；
   - `activeUtility` 计算中移除 `view === "agents"` 分支（`/agents` 路由仍保留，供 AgentPanel 跳转和 URL 直达）；
   - `Sidebar` props 中移除 `onOpenAgents`。

3. 折叠态兜底（可选增强）：折叠侧边栏时 `AgentPanel` 不渲染（现有 `!collapsed` 判断），此时可让折叠态的 Agent 入口以单图标按钮形式出现在动作区末尾（`Bot` 图标，点击进入 `/agents`），避免折叠后无入口。若暂不做，折叠态仅靠会话头部的 Agent 徽标进入，可接受。

### 方案 B（备选）：移除 AgentPanel，保留动作区按钮

若产品更倾向"Agent 统一在 `/agents` 页面管理、侧边栏保持纯会话"，则反向操作：删除 `AgentPanel` 及相关 props（`agents`/`selectedAgentId`/`onSelectAgent`），保留动作区按钮。**不推荐**：与设计文档"联系人列表"描述冲突，且丢失了全局快速切换 Agent 的能力。

## 3. i18n 适配方案（两个方案共用）

### 3.1 新增 locale key

**en/common.json 与 zh-CN/common.json 同步新增顶层 `agents` 命名空间**（两个文件 key 必须一一对应，`webui/src/tests/i18n.test.tsx` 会校验结构一致性）：

```jsonc
// en/common.json
"agents": {
  "workbench": {
    "title": "Agents",
    "subtitle": "Choose an agent profile, inspect its prompt bindings and capabilities, then start a chat with that profile.",
    "refresh": "Refresh",
    "listTitle": "Agent List",
    "empty": "No agents are configured.",
    "noDescription": "No description provided."
  },
  "profile": {
    "title": "Profile",
    "agentId": "Agent ID",
    "modelPreset": "Model Preset",
    "defaultRuntime": "This agent uses the default Nanobot runtime profile."
  },
  "skills": {
    "title": "Skills",
    "empty": "This agent does not bind extra skills.",
    "missing": "Missing skills: {{names}}",
    "disabled": "Disabled skills: {{names}}"
  },
  "tools": {
    "title": "Tools",
    "empty": "This agent can use the default tool set.",
    "missing": "Missing tools: {{names}}"
  },
  "summary": {
    "title": "Capability Summary",
    "skills": "Skills",
    "restrictedTools": "Restricted tools",
    "runtime": "Runtime",
    "available": "Available",
    "blocked": "Blocked"
  },
  "recentChats": {
    "title": "Recent Chats",
    "empty": "No recent chats for this agent.",
    "untitled": "Untitled chat",
    "noPreview": "No preview yet."
  },
  "newChat": "New Chat With Agent",
  "status": {
    "ready": "Ready",
    "needsAttention": "Needs attention",
    "disabled": "Disabled"
  },
  "noProfile": "No agent profile is available."
}
```

```jsonc
// zh-CN/common.json（对应中文）
"agents": {
  "workbench": {
    "title": "Agent 列表",
    "subtitle": "选择一个 Agent 档案，查看其提示词绑定与能力，然后以该档案开始对话。",
    "refresh": "刷新",
    "listTitle": "Agent 列表",
    "empty": "尚未配置任何 Agent。",
    "noDescription": "暂无简介。"
  },
  "profile": {
    "title": "基本信息",
    "agentId": "Agent ID",
    "modelPreset": "模型预设",
    "defaultRuntime": "该 Agent 使用默认 nanobot 运行档案。"
  },
  "skills": {
    "title": "技能",
    "empty": "该 Agent 未绑定额外技能。",
    "missing": "缺失技能：{{names}}",
    "disabled": "已停用技能：{{names}}"
  },
  "tools": {
    "title": "工具",
    "empty": "该 Agent 可使用默认工具集。",
    "missing": "缺失工具：{{names}}"
  },
  "summary": {
    "title": "能力摘要",
    "skills": "技能",
    "restrictedTools": "受限工具",
    "runtime": "运行状态",
    "available": "可用",
    "blocked": "已阻止"
  },
  "recentChats": {
    "title": "最近会话",
    "empty": "该 Agent 暂无最近会话。",
    "untitled": "未命名会话",
    "noPreview": "暂无预览。"
  },
  "newChat": "与该 Agent 开始对话",
  "status": {
    "ready": "就绪",
    "needsAttention": "需要处理",
    "disabled": "已停用"
  },
  "noProfile": "没有可用的 Agent 档案。"
}
```

### 3.2 补齐 Sidebar 已有兜底 key

在 `en/common.json` 与 `zh-CN/common.json` 的 `sidebar` 命名空间中补充：

```jsonc
// en
"sidebar": {
  ...,
  "agents": "Agents",
  "agentUnavailable": "Agent unavailable",
  "defaultModel": "Default model"
}
```

```jsonc
// zh-CN
"sidebar": {
  ...,
  "agents": "Agent",
  "agentUnavailable": "该 Agent 不可用",
  "defaultModel": "默认模型"
}
```

### 3.3 改造 AgentWorkbenchView

- 引入 `useTranslation()`；
- 所有硬编码英文替换为 `t("agents.xxx")`；
- 动态拼接文案（`Missing skills: a, b`）用 `{{names}}` 插值，由组件侧 `join(", ")` 后传入；
- 状态徽标/功能提示（`statusLabel`、`CapabilityPill` 的 label、`agentReady` 提示）全部走 i18n；
- `AgentWorkbenchViewProps` 不变，只改渲染层。

### 3.4 Sidebar 文案清理

`AgentPanel` 中 `t("sidebar.agents", { defaultValue: "Agents" })` 等改为无兜底的正式 key（`t("sidebar.agents")`），避免中文界面出现英文。

## 4. 测试与验证

### 4.1 i18n 结构校验

- `webui/src/tests/i18n.test.tsx` 会自动校验 en/zh key 一致性——新增 `agents.*` 与 `sidebar.*` key 后必须双端同步；
- 新增断言：`agents.workbench.title`、`agents.status.ready`、`sidebar.agents` 在两种 locale 下都存在且非空。

### 4.2 组件测试

- `webui/src/tests/` 新增 `agent-workbench-i18n.test.tsx`（或追加到现有 workbench 相关测试）：
  - 中文 locale 下渲染 `AgentWorkbenchView`，断言出现中文文案（如 "Agent 列表"、"技能"、"开始对话"）；
  - 英文 locale 下断言英文文案；
  - 空 agents、缺失技能/工具、disabled 状态等分支文案正确。
- `webui/src/tests/app-layout.test.tsx`：
  - 若采用方案 A：移除对动作区 `Agents` 按钮的断言（如有），补充 AgentPanel 渲染断言（点击联系人跳转 `/agents`）。

### 4.3 手工验收

1. WebUI 切换中/英文，`/agents` 页面全部文案随语言切换；
2. 侧边栏 AgentPanel 标题、不可用提示、默认模型文案中文化；
3. 方案 A 后：动作区只有 `New Chat / Search / Apps / Skills / Automations`，Agent 入口只剩 AgentPanel 联系人；
4. 点击 AgentPanel 联系人 → 进入 `/agents` 并选中对应 Agent；
5. 折叠侧边栏后仍有可用的 Agent 入口（若实现折叠兜底）。

## 5. 实施顺序

1. **i18n key**：`en/common.json` + `zh-CN/common.json` 同步新增 `agents.*` 与补齐 `sidebar.*`；
2. **AgentWorkbenchView 改造**：硬编码文案全部替换为 `t()` 调用；
3. **Sidebar/App 去重**：按方案 A 删除动作区 `Agents` 按钮与 `onOpenAgents`；
4. **测试**：跑 `bun run test`（重点 `i18n.test.tsx`、`app-layout.test.tsx`、新增 workbench i18n 测试），修复回归；
5. **构建**：`cd webui && bun run build` 确认产物正常。

## 6. 决策点（需确认）

- **方案 A vs 方案 B**：默认按方案 A（保留 AgentPanel 联系人入口、移除动作区按钮）实施，符合 `docs/agent-workbench.md` 产品设计；
- **折叠态入口**：是否需要在折叠侧边栏时保留 Agent 图标按钮（默认先不做，避免再次引入双入口；如产品要求再补）。
