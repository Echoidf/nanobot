# NanoDesk UI 资产与视觉基线

## 资产

- 主 Logo：`images/nanodesk_logo.svg`
- WebUI 图标：`webui/public/brand/nanodesk_mark.svg`
- 现有产品截图：`images/nanodesk_webui.png`，本轮视觉读取因远端视觉服务不可用，原型以生产代码和 design tokens 为准。

## 颜色

- 页面背景：`hsl(0 0% 100%)`
- 正文：`hsl(240 3% 12%)`
- 主色：`hsl(194 72% 38%)`，约 `#1686a8`
- 次级表面：`hsl(0 0% 96.1%)`
- 边框：`hsl(40 8% 90.5%)`
- 成功：emerald 系列，仅用于状态
- 警告：amber 系列，仅用于阻塞或需确认
- 错误：red 系列，仅用于失败和破坏性动作

## 形状与密度

- 紧凑控件半径约 7-12px
- 浮层和主面板可使用 18-22px，但避免嵌套卡片
- 正文 13-14px，辅助信息 11-12px
- 工具界面以扫描效率优先，不使用大标题、厚阴影或大面积品牌色

## 交互基线

- 使用熟悉的 Lucide 图标语义
- 图标按钮提供 tooltip 或 aria-label
- 危险操作使用确认对话框
- 状态不能仅通过颜色表达
- 动效只用于展开、状态变化和定位，不使用持续装饰动效
