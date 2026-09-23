# nanodesk

一个轻量的自托管 AI 助手，用 Python 写成，带浏览器工作台和终端入口。接好模型就能用：聊天、读写文件、跑 shell、定时任务都行。

## 安装

要 Python 3.11 以上，选一种装法：

```bash
uv tool install nanodesk-ai
```

```bash
python -m pip install nanodesk-ai
```

装完先确认能跑：`nanodesk --version`。

## 上手

第一次用，直接起浏览器界面：

```bash
nanodesk webui
```

打开 http://127.0.0.1:8765 ，去 Settings → Models 配好模型，发一句 Hello，能回话就说明通了。

想关掉终端还继续跑：

```bash
nanodesk gateway --background
```

终端里聊：

```bash
nanodesk agent
```

只问一句就走，写脚本时好用：

```bash
nanodesk agent -m "Hello!"
```

## 常用命令

```bash
nanodesk webui               # 浏览器工作台
nanodesk gateway             # 前台跑网关
nanodesk gateway --background  # 后台常驻
nanodesk agent               # 终端交互聊天
nanodesk agent -m "..."      # 单次问答
nanodesk serve               # OpenAI 兼容接口
nanodesk onboard             # 初始化配置和工作区
nanodesk status              # 看配置状态
```

配置文件在 `~/.nanodesk/config.json`。

## 能做什么

浏览器里按话题聊天，看推理过程、工具调用和文件改动；终端里直接问；也能接到 Telegram、Discord、微信、Slack 这类聊天软件。对接 MCP、定时任务、长期记忆都有，需要时再开。

前端在 `webui/` 目录，用 Vite + React，改完跑 `nanodesk webui --dev` 实时预览。
