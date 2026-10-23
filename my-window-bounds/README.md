# MY-Window-Bounds 窗口记忆 (my-window-bounds)

让 DeepSeek Harness 桌面主窗口**记住上次的大小、位置和最大化状态**。

> 来源仓库：[Hotzenplotz-S/dsh-my-plugins](https://github.com/Hotzenplotz-S/dsh-my-plugins)
> （Code → Download ZIP 解压后，安装时指向本 `my-window-bounds/` 目录即可）。

## 为什么需要它

DSH 桌面版的主进程在 `app.asar` 内的 `lib/main.js` 里把主窗口尺寸写死为
`1280×820`，从未持久化窗口边界——每次从托盘完全退出再启动，窗口都会重置。
本插件通过在宿主启动时给 `app.asar` 打**等长补丁**来解决：

- 两个文档注释块被替换为同名字节数的辅助函数（窗口边界的读写、监听与恢复）；
- `width: 1280, height: 820,` 两行被替换为 `...WBS(primary),` + 补齐空格；
- 归档 JSON 头中该文件的 SHA256 完整性哈希被重算（十六进制等长，结构不变）；
- 所有替换都是等长的，归档内每个文件的偏移量保持不变。

补丁逻辑（注入主进程）：启动时读取 `%USERPROFILE%\.dsh\window-bounds.json`
恢复上次的位置/尺寸/最大化状态；运行中监听 resize/move/maximize/unmaximize/close
事件，400ms 防抖后写回该文件。多显示器坐标变化时以当前窗口为准。

## 安装

在 DSH 里安装本 bundle 后，**完全退出 DSH（托盘图标 → 退出）再启动**。

- 第一次打补丁发生在「启用后旧主进程仍在运行」的阶段，所以必须重启一次；
- 第二次启动由打过补丁的主进程开始记忆窗口边界。

## 安全设计

- **自动备份**：首次写入前把原始 `app.asar` 复制为 `app.asar.mywb.bak`；
- **锚点校验**：所有锚点（注释块签名 + 精确字节长度 + 选项两行）必须全部
  唯一匹配，否则原样不动（DSH 升级导致代码变化时会安全地跳过）；
- **幂等**：已打补丁的归档带 `/*my-wb*/` 标记，重复运行直接跳过；
- **冲突检测**：不与其他 asar 桥插件共用锚点；如同时装了
  `dsh-window-control`，先装者生效，后者会因锚点不匹配而跳过，互不影响启动。
- **DSH 自动更新后**：新归档不含标记，本插件会在下次启动时自动重新打补丁；
  若新版本的锚点文本变了，则跳过并把原因写进状态文件。

## 状态查看

每次启动后，结果写入
`%USERPROFILE%\.dsh\profiles\desktop\my-window-bounds-status.json`：

```json
{ "at": "...", "status": "patched", "detail": "lib/main.js +/*my-wb*/", "asarPath": "...", "backupPath": "..." }
```

`status` 取值：`patched`（本次打上）/ `already`（已打过）/ `anchor-miss`
（代码变了，未动归档）/ `busy|error`（写入失败，下次启动重试）/ `no-asar`
（非桌面环境）。

## CLI（可选）

```powershell
# 查看状态 / 手动安装 / 还原（还原前需完全退出 DSH）
node cli.mjs status
node cli.mjs install
node cli.mjs restore
```

也可以用参数显式指定 app.asar 路径：`node cli.mjs status "C:\...\app.asar"`。

## 还原与卸载

1. 完全退出 DSH；
2. `node cli.mjs restore`（或手动把 `app.asar.mywb.bak` 复制回 `app.asar`）；
3. 在 DSH 里卸载本 bundle。

## 数据文件

- 窗口边界：`%USERPROFILE%\.dsh\window-bounds.json`（删除即恢复默认 1280×820 居中）；
- 状态报告：`%USERPROFILE%\.dsh\profiles\desktop\my-window-bounds-status.json`；
- 原始备份：`<安装目录>\resources\app.asar.mywb.bak`。
