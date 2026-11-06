# MY-Suite 功能合集（my-suite）

把 MY 系列里**纯客户端、互不冲突**的小插件合并成一张插件卡片，不占多余栏位。

> **为什么只有一行？**
> 一开始按 dsh-mnemon 的模式做了多行+行开关（my-suite/quote、my-suite/image-chip），
> 但 dsh-client-modules 不允许同一个包被多行 Loader 解析（`package resolves from multiple
> active Loader sources` → 整包被拒 → bundle 不加载），所有功能行必须删掉，只留 bare 行。
> 如需行级开关，以后再在 client.js 内用 localStorage/配置 UI 实现；当前全部功能始终开启。

## 当前收录

| 功能 | 迁移自 |
| --- | --- |
| 划词引用：选中文字→气泡引用到输入框 / 分叉会话 | my-quote v1.1.3 |

> **2026-11-04 变更**：用户弃用「图片气泡」（my-image-chip），已从
> `features/image-chip/`、`package.json` exports 与 `client.js` 中彻底移除。
> 历史实现可从 GitHub 仓库 Hotzenplotz-S/dsh-my-plugins 的提交历史找回。

## 安装 / 从独立插件迁移

1. 插件管理页：先把被合并的旧独立插件（如 **MY-Quote**）**关闭并移除**，避免同一份 UI 出现两次。
2. 安装本包，两种方式任选：
   - **远程安装（推荐，跨设备可复用）**：`plugin_manager install_bundle` 的 target 填
     `github:Hotzenplotz-S/dsh-my-plugins#path:/my-suite`；
   - **本地开发**：插件管理页 → 安装本地包，指向 `plugins/my-suite/`（`link:` 方式，改完即生效）。

## 新增一个功能（维护步骤）

1. `features/<name>/` 下放三件套：`client.js`（模块体，声明 `function apply(ctx)`，
   不带 return——即独立插件 factory 函数体原样）、`locale/zh.json` + `locale/en.json`，可选 `icon.svg`。
2. 跑 `node build-client.mjs` 重新生成 `client.js`。
3. 禁用再启用（或重装）my-suite，验证功能加载。

## 原理备忘

- **必须只用一行**：dsh-client-modules 不允许一个包被多个 Loader 行解析（`reconcilePackage` 行 893 判定 `sources.length > 1` throw）。
  ⚠️ v0.1.0 ~ v0.2.2 都因为这个 bug 全部功能不加载；真相来源于
  `dsh-client-modules/lib/index.js` 源码读到的 `reconcilePackage` 检测逻辑。
- 客户端 bundle 只挂在裸包名行（`my-suite`）上；关掉它整个合集 UI 消失。
- 功能注册在 `client.js` 内，fail-open 设计——apply 即 startAll；收到 `plugin-manager/changed`
  事件后会尝试刷新，但当前只有一行所以无实际意义。
- 行 meta 只走 `package.json` / `locale/zh.json`（单行，无子路径）。

## 卸载 / 还原

1. 插件管理页移除 MY-Suite 功能合集。
2. 如需回到独立插件：my-quote 的旧独立目录已删除，历史版本可从
   GitHub 仓库 Hotzenplotz-S/dsh-my-plugins 的提交历史找回，或直接从
   `features/quote/client.js`（即原 factory 体）还原成独立插件。