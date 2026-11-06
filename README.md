# dsh-my-plugins — MY 系列 DeepSeek Harness 插件

[DeepSeek Harness（DSH）](https://github.com/deepseek-ai/DeepSeek-Harness) 的自研插件合集。
每个插件一个目录，独立安装、独立卸载。命名约定：目录名 = 包名 = `my-<kebab>`，
显示名 = `MY-{English} {中文名}`。

## 插件一览

| 插件（= 目录 = 包名） | 显示名 | 功能 | 类型 |
|------|--------|------|------|
| [my-rewind](./my-rewind/) | MY-Rewind 对话回退 | 消息悬停「回退」撤回到任意历史消息（文本+图片放回输入框），排队消息一键撤回；/rewind、/undo 命令带消息选择器；日志只增不改（`dsh-rewind-plugin` 的 MY 重构版，修复浮层透明重叠） | 宿主 + 客户端 UI |

> **已移除的插件**（保留在此说明，代码可从提交历史找回）：
> - `my-image-chip`（图片气泡）— 2026-11-04 按用户要求移除
> - `my-quote`（划词引用）— 2026-11-06 移除，官方 0.2.2 起内置 `@deepseek-ai/dsh-message-quotes`
> - `my-suite`（客户端功能合集，仅含划词引用）— 2026-11-06 移除，同上被官方覆盖
> - `my-plugin-updates`（插件升级检查，占位桩）— 2026-11-06 移除，官方插件页已有「有新版本」提示
> - `my-window-bounds`（窗口记忆）— 2026-11-06 移除，取决于 asar 补丁，维护成本高于收益

## 安装方法

### 方式一：远程安装（推荐，跨设备可用）

不需要下载代码，直接让 pnpm 从本仓库拉取指定子目录。**目录名就是包名**（当前只有 `my-rewind`）。

在 DSH 里让助手执行 `plugin_manager install_bundle`，其 `target` 填：

```
github:Hotzenplotz-S/dsh-my-plugins#path:/my-rewind
```

或者自己跑命令行（把 `desktop` 换成你的 profile 名）：

```powershell
dsh plugin --profile desktop add "github:Hotzenplotz-S/dsh-my-plugins#path:/my-rewind"
```

装完后 profile 的 `package.json` 里会记录成：

```json
"my-rewind": "git+https://github.com/Hotzenplotz-S/dsh-my-plugins.git#path:/my-rewind"
```

这是**可移植**的引用——同步到另一台电脑后能直接重装；相比之下 `link:D:/...` 的绝对路径
在别的机器上必然失效（这也是本仓库改用远程安装的原因）。

**前提**：本机要有 `git`（pnpm 走 git 协议克隆）。更新插件时重新执行一次指向同一 spec 的安装即可。

> 注意：pnpm 对 `github:` 依赖按**提交哈希**锁定（lockfile 里是 `codeload.github.com/.../tar.gz/<sha>`）。
> 推送新提交后要拿到新代码，需先 `remove_bundle` 再 `install_bundle`（或用 `pnpm update`）。

### 方式二：下载 ZIP（无需 git）

1. 本页面上方 **Code → Download ZIP**，解压；
2. 在 DSH 中让助手执行 `plugin_manager install_bundle`，target 指向解压出来的
   单个插件目录（例如 `.../dsh-my-plugins-main/my-rewind`），
   或在插件管理页手动安装本地 Bundle。

### 方式三：git clone（本地开发用）

```powershell
git clone https://github.com/Hotzenplotz-S/dsh-my-plugins.git
# 然后 install_bundle 指向仓库内的插件子目录（pnpm link: 安装，改代码即改即装）
```

`link:` 安装适合自己改代码时用：改完刷新页面/禁用再启用就生效，不用重新推送。
但 `link:` 指向的是本机绝对路径，**不要把这种 profile 配置同步到别的电脑**。

## 注意事项

- **my-rewind** 与原版 `dsh-rewind-plugin` **不要同时启用**（命令名 rewind/undo/rewind-plugin 冲突；
  my-rewind 已兼容旧会话的隐藏状态，可直接替换）。
- 划词引用无需再装自研插件：DSH 0.2.2 起官方内置 `@deepseek-ai/dsh-message-quotes`。
- 各插件独立安装、独立管理，没有 bundle 级别的耦合。

## 目录即仓库

本仓库根目录与作者工作区的 `plugins/` 文件夹一一对应，新增插件 = 新增一个
`my-<kebab>/` 子目录。维护者用 [sync-github.ps1](./sync-github.ps1) 一键同步
（token 走 `GITHUB_TOKEN` 环境变量，不落盘；本机若被执行策略拦截，用
`powershell -ExecutionPolicy Bypass -File sync-github.ps1` 运行）。

## 许可证

[MIT](./LICENSE) © Hotzenplotz-S