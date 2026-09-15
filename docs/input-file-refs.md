# 对话输入框文件/文件夹引用功能

## 1. 问题

在 WebUI 对话输入框内，用户无法手动引用工作区中的文件或文件夹。现有 `@` 提及只支持 session、CLI App、MCP preset，附件上传是上传文件内容（data URL）而非引用路径，且无法引用文件夹。

## 2. 目标

用户能在输入框内通过 `@` 触发工作区文件/文件夹的路径补全，选中后以结构化引用形式发送给 agent，agent 自动读取文件内容/目录列表并注入上下文。整体交互对齐 Claude Code / Codex / Cursor 的文件引用能力。

## 3. 示例交互流程

```
输入框敲 @  →  弹出补全面板（当前工作区范围内的文件/文件夹）
  ├─ @src/index.ts       匹配文件 → 回车插入彩色 token
  ├─ @docs/              匹配文件夹 → 可继续输入子路径
  └─ @代码库整体搜索      按名称前缀实时过滤

发送后：
  ├─ 消息气泡显示引用 chip（"引用 2 个文件，1 个文件夹"）
  └─ agent 收到结构化引用，自动读取
       ├─ 小文件 → 直接注入内容
       └─ 大文件/二进制 → [Reference: path] 标记，agent 按需用 read_file 读取
```

## 4. 已有关联基础

### 4.1 前端

| 已有模块 | 位置 | 可复用部分 |
|---|---|---|
| `@` 提及补全框架 | `webui/src/components/thread/ThreadComposer.tsx` | `mentionInsertion()`、`CliAppMentionToken`、palette 弹出/过滤/高亮、`MentionCandidate` 类型 |
| 附件上传 | `webui/src/hooks/useAttachedImages.ts` | 附件显示 chip、`SendAttachment` 类型 |
| 工作区作用域 | `webui/src/lib/workspace.ts`、`WorkspaceControls.tsx` | `WorkspaceScopePayload` 结构、作用域来源 |
| 消息发送协议 | `webui/src/lib/nanobot-client.ts` 的 `send()` | `options` 扩展模式（已有 `sessionMentions`、`cliApps` 等结构化字段） |
| 文件预览 | `webui/src/lib/api.ts` 的 `fetchFilePreview` | 已有通过 workspace scope 读文件文本的 API |

### 4.2 后端

| 已有模块 | 位置 | 可复用部分 |
|---|---|---|
| 文件预览 & 安全校验 | `nanobot/webui/file_preview.py` | `resolve_allowed_path`、`WorkspaceScope`、`WorkspaceBoundaryError` 处理 |
| 工作区安全策略 | `nanobot/security/workspace_policy.py` | `resolve_allowed_path()` 路径解析 + 越界拦截 |
| 附件引用注入 | `nanobot/agent/loop.py` 的 `_restore_turn()` | `[Attachment: path]` 注入机制，可作为类似参考 |
| 附件引用测试 | `tests/agent/test_attachment_references.py` | 引用持久化、读取的测试模式 |
| 入站消息解析 | `nanobot/channels/websocket/runtime.py` 的 `_parse_envelope()` | 解析结构化字段的框架 |
| 路由注册 | `nanobot/webui/ws_http.py` | 鉴权 + 路由分发模式 |

### 4.3 消息协议（现有 Outbound 帧示例）

```json
{
  "type": "message",
  "chat_id": "websocket:xxx",
  "content": "检查这个文件",
  "session_mentions": [...],
  "cli_apps": [...],
  "mcp_presets": [...],
  "quoted_context": "...",
  "workspace_scope": {...},
  "webui": true
}
```

## 5. 实现方案

### 5.1 协议层：envelope 增加 `path_refs` 字段

**文件：** `webui/src/lib/nanobot-client.ts`、`nanobot/channels/websocket/runtime.py`

在现有 `send()` 的 `options` 中新增字段：

```typescript
// nanobot-client.ts send() options
pathRefs?: { path: string; kind: "file" | "folder" }[];
```

序列化到帧：

```json
{
  "type": "message",
  "content": "检查这个文件",
  "path_refs": [
    {"path": "src/index.ts", "kind": "file"},
    {"path": "docs/", "kind": "folder"}
  ],
  "webui": true
}
```

**后端解析：** `websocket/runtime.py` 的 `_parse_envelope()` 提取 `path_refs`，放入 `InboundMessage` 的元数据（`metadata["path_refs"]`），或直接作为独立字段。

**持久化：** session 保存时 `path_refs` 随消息一起序列化（类似 `media` 和 `session_mentions`），重启后恢复引用标记。

### 5.2 后端 API：工作区文件浏览/搜索接口

**新增文件：** `nanobot/webui/workspace_files.py`

```
GET /api/webui/workspace/files?dir=<path>&q=<query>&scope=session_key
```

- `dir`：当前目录（默认 `.`，即工作区根）
- `q`：可选前缀过滤（用户输入到一半时过滤）
- `scope`：session_key，用于获取 `WorkspaceScope`

**功能：**
1. 用 `resolve_allowed_path(dir, workspace=scope.project_path, ...)` 校验路径，越界返回 403
2. 遍历目录，返回 `{name, path, kind: "file"|"folder", size?, language?}[]`
3. 过滤噪音目录（`.git`、`node_modules`、`__pycache__`、`__pycache__` 等，对齐 `find_files` 策略）
4. 支持 `q` 前缀过滤（文件名/文件夹名）
5. 限制最大返回条目（如 200），限制深度（如 8 层）
6. 非文本文件标记 `binary: true`，但不阻止引用（agent 可通过 run_cli_app/exec 处理）

**安全：** 复用 `file_preview.py` 的 `resolve_allowed_path` + `WorkspaceScope`，不新增安全路径。

**注册路由：** `nanobot/webui/ws_http.py` 的 `_handle_webui_route()` 增加：

```python
if got == "/api/webui/workspace/files":
    return await self._handle_webui_workspace_files(request)
```

### 5.3 Agent 侧：引用注入

**文件：** `nanobot/agent/loop.py` 的 `_restore_turn()`（与 `[Attachment: path]` 同位置）

**逻辑：**

```python
# 在 _restore_turn 中处理 path_refs
path_refs = getattr(ctx.msg, "path_refs", None)  # 或从 metadata 取
if path_refs:
    refs_content = []
    for ref in path_refs:
        # 校验路径（复用 resolve_allowed_path）
        resolved = resolve_allowed_path(ref.path, ...)
        if ref.kind == "file":
            # 小文件（< 16KB）直接读内容注入
            # 大文件/二进制 → 注入 [Reference: path] 标记
            refs_content.append(f"[File: {resolved}]")
        elif ref.kind == "folder":
            # 注入 list_dir 结果
            refs_content.append(f"[Directory: {resolved}]\n{list_dir_output}")
    # 注入到用户消息中
    ctx.msg.content += "\n\n" + "\n".join(refs_content)
```

**分层策略：**

| 文件大小 | 处理方式 |
|---|---|
| < 16 KB | 直接读内容，注入到用户消息 |
| 16 KB ~ 384 KB | 注入 `[Reference: path]`，提示词说明 agent 应使用 `read_file` 读取 |
| > 384 KB / 二进制 | 注入 `[Reference: path]`，标记为二进制或过大，agent 可选择性处理 |
| 文件夹 | 注入 `list_dir` 结果（最多 100 条目），agent 可进一步展开子目录 |

**阈值常量：** 复用 `file_preview.py` 的 `MAX_FILE_PREVIEW_BYTES`（384 KB），小文件阈值定义为 `16 * 1024`。

**提示词规则：** 在 _build_system_prompt 或 agent_prompt_block 中加入说明，让 agent 理解 `[Reference: path]` 的含义并知道如何用 `read_file`/`list_dir` 读取。

### 5.4 前端：输入框文件提及

**文件：** `webui/src/components/thread/ThreadComposer.tsx`

**新增 hook：** `webui/src/hooks/useWorkspaceFileRefs.ts`

```typescript
interface FileRefCandidate {
  path: string;       // 相对路径
  name: string;       // 显示名称
  kind: "file" | "folder";
  language?: string;  // 文件类型
  binary?: boolean;
}
```

**交互流程：**

1. **触发：** 在输入框敲 `@` 后，`ThreadComposer` 现有的 `@` 检测逻辑扩展 — 识别 `@` 后输入的不是已知 session/CLI App/MCP 名时，降级为文件搜索
2. **查询：** `useWorkspaceFileRefs` hook 防抖 300ms 后调用 `GET /api/webui/workspace/files?q=...`，携带当前 `workspace_scope`
3. **补全：** 复用现有 `mentionInsertion()` 插入 `@path`，文件夹路径后保留 `/` 便于继续输入
4. **高亮：** 复用 `CapabilityMentionToken` / `CliAppMentionText` 的彩色 token 渲染机制
5. **发送：** 发送前从消息文本中提取所有 `@path` token，解析为 `path_refs` 数组，放入 `options.pathRefs`；同时从文本中移除裸 `@path` 标记（或保留为可读形式）
6. **气泡：** 消息气泡展示引用 chip（类似附件 tile 或 session mention chip）

**边界情况：**
- 无网络/接口超时 → 静默降级，不阻塞输入，不弹错误
- 引用已删除文件 → 后端 `resolve_allowed_path` 返回 404，agent 提示"文件不存在"
- 引用越界路径 → 后端返回 403，agent 提示"不在工作区范围内"
- 递归引用（引用了被删除的引用）→ 重复引用去重，按路径去重

### 5.5 会话持久化

**文件：** `nanobot/session/manager.py`、`nanobot/webui/session_list_index.py`

`path_refs` 随消息一起持久化（类似 `session_mentions`），刷新后能恢复引用标记：
- 序列化时 `path_refs` 作为消息的附属字段
- 恢复时重新用 `resolve_allowed_path` 校验（文件可能已被删除，标记为"已删除"并提示）

## 6. 安全边界

| 风险 | 防护 |
|---|---|
| 越界读取工作区外文件 | `resolve_allowed_path` + `WorkspaceScope`，与 `file_preview` 一致 |
| 路径遍历攻击 | `resolve_allowed_path` 拒绝 `..` 越界 |
| 引用过多撑爆上下文 | 单条消息限制 ≤ 20 个引用，注入内容总量 ≤ 64 KB |
| 大文件自动读取 | 仅 < 16 KB 自动读，其余标记为引用让 agent 按需读 |
| 文件夹递归爆炸 | 仅列一级目录，最多 100 条目，不递归 |

## 7. 测试

### 7.1 后端 API

**新增文件：** `tests/webui/test_workspace_files.py`

| 测试 | 场景 |
|---|---|
| 列表根目录 | 返回工作区根内容，过滤噪音目录 |
| 列表子目录 | 返回指定子目录内容 |
| 前缀过滤 | `q=src` 返回匹配的文件/文件夹 |
| 越界路径 | 403 拒绝 |
| 不存在路径 | 404 提示 |
| 深度限制 | 超过 8 层返回 400 |
| 空目录 | 返回空列表 |

### 7.2 Agent 引用注入

**新增/追加测试：** `tests/agent/test_attachment_references.py`（追加）

| 测试 | 场景 |
|---|---|
| 文件引用注入 | 小文件自动读内容，大文件标记引用 |
| 文件夹引用注入 | 注入 `list_dir` 结果 |
| 越界引用 | 拒绝并提示 |
| 持久化 | 刷新后恢复引用标记 |
| 引用去重 | 同一路径多次引用只注入一次 |

### 7.3 前端

**现有文件：** `webui/src/tests/thread-composer.test.tsx`（追加）

| 测试 | 场景 |
|---|---|
| `@` 触发文件补全 | 输入 `@src/` 弹出候选 |
| 选中文件 | 插入 `@path` token |
| 发送含引用消息 | `path_refs` 正确序列化 |
| 接口失败 | 无网络时静默降级 |
| 路径安全 | 非法路径提示 |

## 8. 实施顺序

### Phase 1 — 后端 API + 安全（独立可验证，不依赖前端）

1. 新建 `nanobot/webui/workspace_files.py`：实现 `GET /api/webui/workspace/files` 接口
2. `nanobot/webui/ws_http.py`：注册路由 + 鉴权
3. 写 `tests/webui/test_workspace_files.py` 覆盖所有边界
4. 验证：`curl` 直接调用 API 检查

### Phase 2 — 协议字段 + Agent 注入

1. `nanobot/channels/websocket/runtime.py`：解析 `path_refs` 字段
2. `nanobot/agent/loop.py` `_restore_turn()`：处理引用注入逻辑
3. 追加 `tests/agent/test_attachment_references.py` 覆盖引用场景
4. 验证：CLI 发送含 `path_refs` 的模拟消息，检查 agent 上下文是否包含文件内容

### Phase 3 — 前端补全 UI

1. `webui/src/hooks/useWorkspaceFileRefs.ts`：防抖查询 hook
2. `webui/src/components/thread/ThreadComposer.tsx`：扩展 `@` 检测逻辑，加入文件候选
3. `webui/src/lib/nanobot-client.ts`：`send()` 增加 `pathRefs` 选项
4. 消息气泡展示引用 chip
5. 追加 `webui/src/tests/thread-composer.test.tsx` 测试
6. 验证：端到端输入 `@` → 补全 → 发送 → agent 读取

## 9. 参考资料

- 现有 `@` 提及补全框架：`webui/src/components/thread/ThreadComposer.tsx` 的 `filteredMentionCandidates`、`mentionInsertion()`、`CapabilityMentionToken`
- 现有附件引用注入：`nanobot/agent/loop.py` 的 `_restore_turn()` 中 `[Attachment: path]` 处理逻辑
- 现有文件预览安全校验：`nanobot/webui/file_preview.py` 的 `resolve_allowed_path` + `WorkspaceScope`
- 现有工作区作用域协议：`webui/src/lib/workspace.ts`、`nanobot/security/workspace_policy.py`
- 测试参考：`tests/agent/test_attachment_references.py`