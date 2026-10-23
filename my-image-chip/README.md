# MY-Quote 划词引用

选中 AI 回复（或对话区任意文字）后弹出浮动条，一键引用。

## 功能

1. **引用到输入框**（气泡形式）
   - 引用以原生 reference 气泡落在输入框草稿**光标处**（通常是末尾），不会覆盖你已经写的文字；
     连续引用时**新气泡排在旧引用下方**，按时间顺序累积；
   - 气泡后自动补换行，插入后**自动聚焦输入框**（立即一次 + 60ms/180ms 延迟重试，对抗宿主 React 重渲染夺焦）；
   - **鼠标悬停气泡**显示完整引用内容（气泡索引持久化在 localStorage，刷新页面后仍可悬停）；
   - 发送时引用以 Markdown `>` 引用块发给模型。
2. **新开分叉（引用预填）**
   - `fork` 当前会话，分叉在**主会话区**打开（DSH 右侧栏的 subagentchat 页签只接受
     `origin==="subagent"` 的委派子会话，普通 fork 会被 `subagent/unauthorized` 拒绝，
     这是宿主限制，不是插件能绕过的）；
   - 分叉标题自动取「└ 引用：<首行>」（「└」前缀用于在侧栏平铺列表里一眼认出分叉归属；
     插件 rename 写入的标题来源是 user 类，DSH 自动标题生成不会覆盖它），
     引用内容预填进分叉输入框（**不发送**，你自己组织问题）；
   - 已存在草稿不会被覆盖，引用追加在后面；
   - 同时会自动亮出右侧栏的「引用分叉」管理页签。
3. **分叉管理页**（可选）
   - 右侧栏指南（guide）里出现「引用分叉」入口，打开后按会话列出本插件创建的全部分叉；
   - 每条支持「打开」（在主会话区切到该分叉）与「归档」（调用 uiWorkspace.archiveSession 并标记）；
   - 记录存 localStorage，每个会话最多 50 条。

浮动条上另有「复制」备用项。划词范围只认对话区（`[data-conversation-content]`），在输入框草稿里划词不会弹条。

## 实现要点

- 气泡：`inputTriggers.registerSource` 注册引用源（发送时由 `codec.serialize` 展开为 Markdown），
  `conversation.input.shell(sessionId).insertReference` 落到光标处；失败依次降级
  `slash/input-insert-reference` 事件 → `insertText` 纯文本引用块。
- 悬停卡片：按气泡渲染文本在 `[data-composer-card]` 内匹配 DOM 节点挂 `mouseenter/mouseleave`；
  **对宿主 DOM 零写入**——已接管节点记进 WeakSet（不写 `data-*` 属性，避免与 React 虚拟 DOM 打架导致输入框高度抖动），
  MutationObserver 只听 childList（characterData 会让每次击键都触发全卡扫描）。
- 主题：全部走 `--dsw-alias-*` token 跟随深浅色；tooltip/toast 文字色固定 `--dsw-static-neutral-bluish-00`
  （不要用 `label-primary-inverted`——深色主题下"反色"是深色，深底深字看不清）。
- 分叉：`sessions.fork` + `uiWorkspace.openSession(threadId)` 在主会话区打开；
  预填用 `shell.setDraft` 轮询（25×200ms 等分叉的输入框挂载）。
  （v1.0.0 曾按参考插件走 `dsh-resource://subagentchat/session/<id>?parent=..&mode=continuable`，
  实测被宿主 `subagent/unauthorized` 拒绝——该地址要求会话头 `origin==="subagent"`，
  只有委派子会话满足，普通 fork 不行。）
- 管理页：`sidebarRightTabs.register` + `sidebar.right.pane.tab(.title)` slot；服务晚到经 `ctx.inject` 兜底。

## 安装 / 卸载

安装（指向本目录，pnpm `link:`）：

```
plugin_manager install_bundle  target=D:\OneDrive\AI Agent\DSH-使用顾问\plugins\my-quote
```

改完代码需 `remove_bundle` 再 `install_bundle`（或升 package.json 的 version）——宿主 ESM 有模块缓存。

卸载：`plugin_manager remove_bundle target=my-quote`。卸载后 localStorage 中的
`my-quote:v1:chips` / `my-quote:v1:forks` 记录会保留，可在浏览器控制台手动清除。

## 冲突提示

与其他划词浮动条类插件（如 `dsh-client-ui-quote`）**不要同时启用**，两者都监听全局选区会重复弹条。
