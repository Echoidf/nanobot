# Agent 联系人工作台

## 1. 产品目标

将 WebUI 从单一聊天入口改为类似 QQ 联系人的 Agent 工作台：用户先选择 Agent，再查看其能力并开始对话。

Agent 是一个轻量的能力组合，不做复杂的生命周期管理。首版只关心：

- Agent 名称、头像、简介；
- 可使用的 Skills；
- 可使用的 Tools；
- 对话入口和运行状态。

缺陷排查只是一个 Agent 的使用场景，不能写入 WebUI 的固定页面结构。

## 2. 首版功能

### Agent 列表

- 联系人式头像列表，可按名称搜索；
- 显示名称、简介、在线/可用状态；
- 点击头像进入 Agent 详情；
- 点击“开始对话”创建或打开该 Agent 的会话。

### Agent 详情

展示四类信息：

- 基本信息：头像、名称、简介、当前模型；
- Skills：已启用和可选 Skills；
- Tools：可用工具及简短说明；

首版允许在详情页启用或停用 Skill。Tools 先由 Agent 配置决定，页面只展示，不提供复杂权限编辑。

### Agent 对话

- 会话标题和头像显示当前 Agent；
- 用户输入、附件和历史消息沿用现有聊天能力；
- 运行中展示 Agent、Skill、Tool 的活动记录；
- 支持停止、继续和重新开始对话。

## 3. 能力编排

Agent 配置采用最小结构：

```yaml
agents:
  - id: defect-investigator
    name: 缺陷排查
    icon: bug
    description: 根据日志、测试输出和代码变更分析问题
    model: default
    skills:
      - git-analysis
      - test-analysis
    tools:
      - read_file
      - list_dir
      - exec
```

编排规则：

1. Agent 只引用已注册的 Skill 和 Tool，不复制它们的实现；
2. Skill 负责流程知识和领域规则；
3. Tool 负责实际操作，例如读文件、Git 查询和测试执行；
4. Agent 启动对话时，根据配置筛选当前可用的 Skills 和 Tools；
5. 未列入 Agent 配置的能力不进入本次运行；
6. Skill 冲突或 Tool 不存在时，明确提示并阻止运行，不静默替换。

首版不做 Agent 间编排，不做动态生成 Skill/Tool，不做发布审批和版本回滚。

## 4. 提示词发送

提示词分为三层：

```text
系统提示词
  = nanobot 基础规则
  + Agent 简介和行为约束
  + Agent 已激活 Skills 内容
  + 当前运行可用的 Tool 定义

会话历史
  = 当前 Agent 对话历史

用户消息
  = 本轮输入和附件
```

发送规则：

- Agent 配置在创建会话时确定，并绑定到会话；
- 每次模型调用都发送当前 Agent 的系统提示词和工具定义；
- Skill 内容放入 system message，不拼接到用户消息；
- Tool 以模型原生工具定义发送，调用结果作为 tool message 返回；
- 用户消息只包含用户输入、附件和必要的运行上下文；
- WebUI 不直接拼接最终 Prompt，后端统一组装；
- 运行事件只展示过程，不作为下一轮对话的隐式提示词。

## 5. Tools 注册与扩展

现有 `tools` 注册方式分三类：

1. 内置 Tool：放在 `nanobot/agent/tools/` 下，继承 `Tool` 基类；启动时 `ToolLoader` 用 `pkgutil.iter_modules(...)` 自动扫描并注册。
2. 外部 Python 插件 Tool：在独立包的 `pyproject.toml` 里声明 `[project.entry-points."nanobot.tools"]`，启动时 `ToolLoader._discover_plugins()` 自动加载。
3. MCP Tool：不直接写进 `nanobot/agent/tools/`，而是通过 MCP server 配置接入，连接后由 `MCPProvider` 动态注册到 `ToolRegistry`。

结论：后续可以自定义开发 `tools`。

- 想做项目内工具：直接在 `nanobot/agent/tools/` 新增模块；
- 想做可复用插件：单独发一个 Python 包，用 `nanobot.tools` entry point 接入；
- 想接第三方能力服务：优先走 MCP。

自定义 Tool 的最小要求：

- 继承 `nanobot.agent.tools.base.Tool`；
- 实现 `name`、`description`、`parameters`、`execute()`；
- 需要按配置开关时，补 `config_key`、`enabled()`、`create()`；
- 需要限制使用场景时，设置 `_scopes`，例如 `{"core"}` 或 `{"subagent"}`。

首版工作台只展示 Agent 当前可用 tools，不做在线注册、在线编写和热发布。

## 6. 开发范围

### 后端

- 增加 Agent 配置加载和校验；
- 增加 Agent 列表、详情接口；
- 增加 Agent 与会话的绑定信息；
- 在现有 ContextBuilder/ToolRegistry 入口按 Agent 配置筛选 Skills 和 Tools；
- 沿用现有 WebSocket 对话和运行时事件协议；
- 增加 Agent 运行信息到会话和运行事件中。

建议接口：

```text
GET  /api/agents
GET  /api/agents/{agent_id}
POST /api/agents/{agent_id}/chat
```

其中对话接口可以先复用现有 WebSocket，不必新增独立的 HTTP 流式协议。Agent ID 放入创建会话或发送消息的元数据中，由后端绑定并校验。

### WebUI

- 将现有聊天入口旁增加 Agent 联系人列表；
- 新增 Agent 详情面板；
- 新增 Agent 信息、Skills、Tools 三个详情区块；
- 创建会话时携带 Agent ID；
- 在 Thread Header 和运行活动中显示 Agent 头像/名称；
- 复用现有 Skills API、工具轨迹和 WebSocket 事件组件。

## 7. 首个交付标准

用户可以完成以下流程：

```text
打开 WebUI
  -> 看到 Agent 联系人列表
  -> 点击头像查看 Skills、Tools
  -> 开始对话
  -> Agent 使用已配置能力回答
  -> 查看运行过程和结果
```

其他 Agent 类型只需要新增配置和能力组合，不需要修改联系人列表、详情页和对话页的整体结构。
