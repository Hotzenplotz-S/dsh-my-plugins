# dsh-my-plugins — MY 系列 DeepSeek Harness 插件

[DeepSeek Harness（DSH）](https://github.com/deepseek-ai/DeepSeek-Harness) 的自研插件合集。
每个插件一个目录，独立安装、独立卸载。命名约定：目录名 = 包名 = `my-<kebab>`，
显示名 = `MY-{English} {中文名}`。

## 插件一览

| 插件 | 显示名 | 功能 | 类型 |
|------|--------|------|------|
| [my-window-bounds](./my-window-bounds/) | MY-Window-Bounds 窗口记忆 | 让 DSH 桌面主窗口记住上次的大小、位置和最大化状态（等长 asar 补丁，自动备份、可一键还原） | 宿主 / 桌面主进程 |
| [my-quote](./my-quote/) | MY-Quote 划词引用 | 选中对话文字一键以气泡引用到输入框（悬停看全文），或新开分叉会话继续讨论，附分叉管理页 | 客户端 UI |
| [my-image-chip](./my-image-chip/) | MY-Image-Chip 图片气泡 | 粘贴/拖入图片时在输入框光标处插入编号气泡，说明文字写在气泡旁，图片与文字按编号一起发给模型；悬停看大图，可拖动换位 | 客户端 UI |

## 安装方法

### 方式一：下载 ZIP（无需 git）

1. 本页面上方 **Code → Download ZIP**，解压；
2. 在 DSH 中让助手执行 `plugin_manager install_bundle`，target 指向解压出来的
   单个插件目录（例如 `.../dsh-my-plugins-main/my-window-bounds`），
   或在插件管理页手动安装本地 Bundle；
3. 按各插件 README 的说明操作（`my-window-bounds` 需完全退出 DSH 再启动才生效）。

### 方式二：git clone

```powershell
git clone https://github.com/Hotzenplotz-S/dsh-my-plugins.git
# 然后 install_bundle 指向仓库内的插件子目录（pnpm link: 安装，改代码即改即装）
```

## 注意事项

- **my-window-bounds 会给 DSH 的 `app.asar` 打补丁**（等长替换，附自动备份与还原脚本），
  原理与风险见其 [README](./my-window-bounds/README.md)。DSH 升级后补丁会自动重打，
  锚点对不上时会安全跳过并写状态文件，不会损坏安装。
- my-quote 与其他划词浮条类插件（如 `dsh-client-ui-quote`）**不要同时启用**，会重复弹条。

## 目录即仓库

本仓库根目录与作者工作区的 `plugins/` 文件夹一一对应，新增插件 = 新增一个
`my-<kebab>/` 子目录。维护者用 [sync-github.ps1](./sync-github.ps1) 一键同步
（token 走 `GITHUB_TOKEN` 环境变量，不落盘；本机若被执行策略拦截，用
`powershell -ExecutionPolicy Bypass -File sync-github.ps1` 运行）。

## 许可证

[MIT](./LICENSE) © Hotzenplotz-S
