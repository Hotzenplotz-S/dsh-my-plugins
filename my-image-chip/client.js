/**
 * MY-Image-Chip 图片气泡 — Client 半边（Host 半边是空 apply）。
 *
 * 粘贴/拖入图片 → 原生附件管线照常收图（只观察、零拦截）→ 在草稿光标处
 * 为每张图片插一个编号气泡（🖼 图片N），说明文字直接写在气泡旁。
 * 发送时：图片按附件顺序传给模型，气泡序列化成 [图片N] 标记 —— 编号即绑定键。
 *
 * 实现要点：
 *   - 不拦截 paste/drop（原生管线在更早的监听里已完成收图与上传），
 *     本插件在 document 冒泡阶段对比 shell.snapshot.attachmentIds 找出新附件，
 *     与本次事件的 File 按序配对（拿预览 URL 与文件名）；
 *   - 气泡 = inputTriggers 注册的引用源 + conversation.input.shell(sessionId).insertReference；
 *   - 悬停 = document 级 mouseover 委托，按气泡文本里的编号查注册表弹预览卡；
 *   - 拖动 = 指针式（cloneNode 幻影 + 落点光标条），编号不随位置变；
 *   - conversation.input.overlay 上的 Bridge 组件只为每个会话留下 inputActions 与 t()。
 */
window.__ModuleLoader__.load({
  id: "my-image-chip",
  factory(require) {
    const react = require("react");
    const h = react.createElement;

    /* ------------------------------------------------------------------ *
     * 文案
     * ------------------------------------------------------------------ */
    const NS = "my-image-chip";
    const zh = {
      imageLabel: "🖼 图片{n}",
      imageMarker: "[图片{n}]",
      previewMissing: "预览不可用（图片仍会随消息发送）",
      batchPartial: "部分文件超出数量/大小限制，本次未生成气泡",
      failed: "插入失败，请重试"
    };
    const en = {
      imageLabel: "🖼 Image {n}",
      imageMarker: "[Image {n}]",
      previewMissing: "Preview unavailable (the image is still sent)",
      batchPartial: "Some files were rejected by limits; no chips created this time",
      failed: "Could not insert, try again"
    };

    /* ------------------------------------------------------------------ *
     * 常量
     * ------------------------------------------------------------------ */
    const STYLE_ID = "myi-style";
    const POPOVER_ID = "myi-popover";
    const TOAST_ID = "myi-toast";
    const CONTENT_SELECTOR = "[data-conversation-content]";
    const CARD_SELECTOR = "[data-composer-card]";
    const COMPOSER_SELECTOR = "[data-composer-input]";
    /** 引用源名字：触发符用输入面检测不到的 "#"，气泡只由本插件插入。 */
    const SOURCE_NAME = "my-image";
    const SOURCE_TRIGGER = "#";
    const TOAST_MS = 1800;
    const POPOVER_HIDE_MS = 140;
    const EDGE = 8;
    const GAP = 8;
    const REGISTRY_LIMIT = 200;

    /* ------------------------------------------------------------------ *
     * 样式（全部走 DSH 原生 --dsw-alias-* 主题 token，跟随浅色/深色）
     * ------------------------------------------------------------------ */
    const STYLE_TEXT = `
#${POPOVER_ID}{position:fixed;z-index:2147483001;display:none;box-sizing:border-box;max-width:340px;
padding:8px;background:var(--dsw-alias-tooltip-bg,#26282e);color:var(--dsw-static-neutral-bluish-00,#f2f3f5);
border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));border-radius:10px;
box-shadow:0 10px 30px rgba(0,0,0,.3);font-family:inherit;font-size:12px;line-height:18px;-webkit-app-region:no-drag}
#${POPOVER_ID} .myi-pop-img{display:block;max-width:324px;max-height:260px;border-radius:6px;object-fit:contain}
#${POPOVER_ID} .myi-pop-name{margin-top:6px;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:324px}
#${POPOVER_ID} .myi-pop-missing{padding:6px 4px;opacity:.9}
#${TOAST_ID}{position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:2147483002;
padding:6px 12px;border-radius:8px;background:var(--dsw-alias-toast-bg,#26282e);
color:var(--dsw-alias-toast-label,#ffffff);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));
font-family:inherit;font-size:12.5px;box-shadow:0 6px 20px rgba(0,0,0,.24);-webkit-app-region:no-drag}
[data-composer-chip="${SOURCE_NAME}"]{cursor:grab}
[data-composer-chip="${SOURCE_NAME}"]:active{cursor:grabbing}
/* 原生图片栏里的图片项与气泡重复 ⇒ 只藏图片项，文件卡片保留。
   （.srf2qa_/.Mrat-G_ 是宿主 CSS Modules 哈希类名，DSH 升级后可能改名；
     失效的最坏结果只是图片栏重新显示，不影响功能。）*/
.srf2qa_rail .Mrat-G_item:has(> .srf2qa_imageItem){display:none}
.srf2qa_rail:not(:has(.Mrat-G_item > :not(.srf2qa_imageItem))){display:none}
`;

    /* ------------------------------------------------------------------ *
     * 小工具
     * ------------------------------------------------------------------ */
    function el(doc, tag, props, children) {
      const node = doc.createElement(tag);
      if (props !== undefined && props !== null) {
        for (const key of Object.keys(props)) {
          const value = props[key];
          if (value === undefined || value === null) continue;
          if (key === "class") node.className = value;
          else if (key === "text") node.textContent = value;
          else node.setAttribute(key, value === true ? "" : String(value));
        }
      }
      if (Array.isArray(children)) {
        for (const child of children) {
          if (child === null || child === undefined) continue;
          node.append(child !== null && typeof child === "object" && typeof child.nodeType === "number" ? child : doc.createTextNode(String(child)));
        }
      }
      return node;
    }
    function elementOf(node) {
      if (node === null || node === undefined) return null;
      if (node.nodeType === 1) return node;
      return node.parentElement === undefined ? null : node.parentElement;
    }
    function closestFrom(node, selector) {
      const element = elementOf(node);
      if (element === null || typeof element.closest !== "function") return null;
      return element.closest(selector);
    }
    function clamp(value, min, max) {
      if (!Number.isFinite(value)) return min;
      if (max < min) return min;
      return Math.min(Math.max(value, min), max);
    }
    function fill(template, n) {
      return String(template).replace("{n}", String(n));
    }
    /** 文件名中间省略：保留开头与扩展名一截，避免长文件名占满输入框。 */
    function clipMiddle(value, max) {
      const text = String(value ?? "");
      if (text.length <= max) return text;
      const tail = 5;
      const head = Math.max(1, max - tail - 1);
      return text.slice(0, head) + "…" + text.slice(text.length - tail);
    }

    /* ------------------------------------------------------------------ *
     * 宿主上下文与服务读取（全部优雅降级）
     * ------------------------------------------------------------------ */
    let pluginCtx = null;
    /** sessionId -> { actions(), translate(key) }，由 Bridge 组件按会话登记。 */
    const bridges = new Map();

    function serviceOf(name) {
      if (pluginCtx === null || pluginCtx === undefined) return null;
      try {
        if (typeof pluginCtx.get === "function") {
          const viaGet = pluginCtx.get(name);
          if (viaGet !== undefined && viaGet !== null) return viaGet;
        }
      } catch (error) {
        // 继续尝试属性形态。
      }
      try {
        const value = pluginCtx[name];
        return value === undefined ? null : value;
      } catch (error) {
        return null;
      }
    }

    function translateFor(sessionId, key) {
      const entry = typeof sessionId === "string" ? bridges.get(sessionId) : undefined;
      if (entry !== undefined && entry !== null) {
        const value = entry.translate(key);
        if (typeof value === "string" && value !== "") return value;
      }
      return zh[key] === undefined ? key : zh[key];
    }

    /* ------------------------------------------------------------------ *
     * 引用源（发送时宿主回调 codec.serialize 把气泡展开成 [图片N] 标记）
     * ------------------------------------------------------------------ */
    function parseRef(ref) {
      try {
        const parsed = JSON.parse(String(ref));
        if (parsed !== null && typeof parsed === "object" && Number.isFinite(parsed.n)) {
          return { id: String(parsed.id ?? ""), n: parsed.n, name: typeof parsed.name === "string" ? parsed.name : "" };
        }
      } catch (error) {
        // 坏 ref 不构成故障。
      }
      return null;
    }
    const imageSource = {
      trigger: SOURCE_TRIGGER,
      name: SOURCE_NAME,
      showGroupTitle: false,
      candidates: () => [],
      codec: {
        clipboardText: (ref) => {
          const parsed = parseRef(ref);
          return parsed === null ? String(ref) : fill(zh.imageMarker, parsed.n);
        },
        serialize: (ref) => {
          const parsed = parseRef(ref);
          // 序列化带上文件名：模型侧每张图前都有宿主生成的 Image "文件名" (id) 句柄文本，
          // 文件名让 [图片N] 标记与句柄精确对上号，不再只靠顺序推断。
          if (parsed === null) return Promise.resolve(String(ref));
          const marker = fill(zh.imageMarker, parsed.n);
          return Promise.resolve(parsed.name === "" ? marker : marker.slice(0, -1) + ": " + parsed.name + "]");
        }
      }
    };
    let sourceDisposer = null;
    let sourceRegistered = false;
    let sourceHolders = 0;

    function ensureSource() {
      if (sourceRegistered) return true;
      if (pluginCtx === null) return false;
      let service = null;
      try {
        service = pluginCtx.get("inputTriggers");
      } catch (error) {
        service = null;
      }
      if (service === null || service === undefined || typeof service.registerSource !== "function") return false;
      try {
        const disposer = service.registerSource(imageSource);
        sourceDisposer = typeof disposer === "function" ? disposer : () => {};
        sourceRegistered = true;
        return true;
      } catch (error) {
        // 重复挂载时源已存在：驻留注册可用，但本次挂载不持有它的注销权。
        sourceRegistered = true;
        sourceDisposer = null;
        return true;
      }
    }
    function holdSource() {
      sourceHolders += 1;
      ensureSource();
    }
    function releaseSource() {
      sourceHolders = Math.max(0, sourceHolders - 1);
      if (sourceHolders > 0) return;
      sourceRegistered = false;
      const disposer = sourceDisposer;
      sourceDisposer = null;
      if (disposer === null) return;
      try {
        disposer();
      } catch (error) {
        // 卸载尽力而为。
      }
    }

    /* ------------------------------------------------------------------ *
     * 输入框插入
     * ------------------------------------------------------------------ */
    function inputShellFor(sessionId) {
      if (pluginCtx === null || typeof sessionId !== "string" || sessionId === "") return null;
      let hub = null;
      try {
        const conversation = pluginCtx.get("conversation");
        hub = conversation === null || conversation === undefined ? null : conversation.input;
      } catch (error) {
        hub = null;
      }
      if (hub === null || hub === undefined || typeof hub.shell !== "function") return null;
      try {
        const shell = hub.shell(sessionId);
        return shell === null || shell === undefined ? null : shell;
      } catch (error) {
        return null;
      }
    }
    /** 能写字的插入面：挂着的 slot 条目优先，否则用宿主 shell 自带的 actions。 */
    function insertionFace(sessionId, shell) {
      const entry = typeof sessionId === "string" ? bridges.get(sessionId) : undefined;
      if (entry !== undefined && entry !== null) return entry;
      const actions = shell === null || shell === undefined ? null : shell.actions;
      if (actions === null || actions === undefined || typeof actions.captureInsertion !== "function") return null;
      return { actions: () => actions };
    }
    function sessionActx(sessionId) {
      const services = serviceOf("sessions");
      if (services === null || services === undefined || typeof sessionId !== "string" || sessionId === "") return null;
      try {
        if (typeof services.binding === "function") {
          const binding = services.binding(sessionId);
          if (binding !== null && binding !== undefined && binding.ctx !== null && binding.ctx !== undefined) return binding.ctx;
        }
      } catch (error) {
        // 落到普通 scope。
      }
      try {
        if (typeof services.scope === "function") return services.scope(sessionId) ?? null;
      } catch (error) {
        return null;
      }
      return null;
    }
    function dispatchInputEvent(actx, name, payload) {
      if (actx === null || actx === undefined || typeof actx.bail !== "function") return false;
      try {
        return actx.bail(actx, name, payload) === true;
      } catch (error) {
        return false;
      }
    }
    function composerEditor() {
      const host = document.querySelector(COMPOSER_SELECTOR);
      if (host === null) return null;
      if (host.isContentEditable === true) return host;
      if (typeof host.querySelector === "function") {
        const inner = host.querySelector("[contenteditable='true']");
        if (inner !== null) return inner;
      }
      return host;
    }
    /** 重新聚焦但不移动选区：React 重渲染会夺焦，贴图后光标要留在气泡旁。 */
    function focusComposerKeep(sessionId) {
      const shell = inputShellFor(sessionId);
      const editor = shell === null || shell === undefined ? null : shell.editor;
      if (editor !== null && editor !== undefined && typeof editor.focus === "function") {
        try {
          editor.focus();
        } catch (error) {
          // 失败走 DOM 兜底。
        }
      }
      for (const delay of [60, 180]) {
        setTimeout(() => {
          try {
            const target = composerEditor();
            if (target === null || typeof document === "undefined") return;
            const active = document.activeElement;
            if (active === target || (active !== null && typeof target.contains === "function" && target.contains(active))) return;
            if (editor !== null && editor !== undefined && typeof editor.focus === "function") {
              editor.focus();
              return;
            }
            if (typeof target.focus === "function") target.focus({ preventScroll: true });
          } catch (error) {
            // 聚焦失败不打扰用户。
          }
        }, delay);
      }
    }
    /** 纯文本兜底：气泡插不进去时至少把 [图片N] 标记写进草稿。 */
    function insertMarkerText(entry, marker) {
      const actions = entry.actions();
      if (actions === null || actions === undefined || typeof actions.captureInsertion !== "function" || typeof actions.insertText !== "function") return false;
      try {
        const span = actions.captureInsertion();
        return actions.insertText(marker, span) === true;
      } catch (error) {
        return false;
      }
    }
    /**
     * 插一个图片气泡到草稿光标处：shell.insertReference 直达，
     * slash/input-insert-reference 事件兜底，再退化为纯文本标记。
     * 气泡后补一个空格，方便接着写说明；之后只聚焦不移动选区。
     */
    function insertImageChip(sessionId, record) {
      if (!ensureSource() || pluginCtx === null) return false;
      const shell = inputShellFor(sessionId);
      const entry = insertionFace(sessionId, shell);
      if (entry === null) return false;
      const marker = fill(zh.imageMarker, record.n);
      const attachment = {
        source: SOURCE_NAME,
        ref: JSON.stringify({ id: record.id, n: record.n, name: record.name }),
        label: fill(translateFor(sessionId, "imageLabel"), record.n) + "·" + clipMiddle(record.name, 14),
        appearance: "session",
        clipboardText: marker
      };
      const actions = entry.actions();
      if (actions === null || actions === undefined || typeof actions.captureInsertion !== "function") {
        return insertMarkerText(entry, marker);
      }
      let inserted = false;
      if (shell !== null && shell !== undefined && typeof shell.insertReference === "function") {
        try {
          inserted = shell.insertReference(attachment, actions.captureInsertion()) === true;
        } catch (error) {
          inserted = false;
        }
      }
      if (!inserted) {
        const actx = sessionActx(sessionId);
        inserted = dispatchInputEvent(actx, "slash/input-insert-reference", { reference: attachment, span: actions.captureInsertion() });
      }
      if (!inserted) return insertMarkerText(entry, marker);
      // 气泡后补一个空格，说明文字与气泡分开。
      try {
        if (typeof actions.insertText === "function") actions.insertText(" ", actions.captureInsertion());
      } catch (error) {
        // 空格补不上不影响气泡本身。
      }
      focusComposerKeep(sessionId);
      return true;
    }

    /* ------------------------------------------------------------------ *
     * 附件观察：对比 shell.snapshot.attachmentIds 找新附件，与事件 File 配对
     * ------------------------------------------------------------------ */
    /** sessionId -> Set<attachmentId>：已认领到基线里的附件（含原生收图）。 */
    const knownAttachments = new Map();
    /** sessionId -> Map<n, { id, url, name }>：本插件登记的图片（编号唯一递增）。 */
    const registry = new Map();
    /** sessionId -> number：已用到的最大编号。 */
    const counters = new Map();

    function attachmentIdsOf(sessionId) {
      const shell = inputShellFor(sessionId);
      const snapshot = shell === null || shell === undefined ? null : shell.snapshot;
      const ids = snapshot === null || snapshot === undefined ? null : snapshot.attachmentIds;
      return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
    }
    /** 把当前附件列表收进基线（Bridge 挂载时与每次 diff 之后调用）。 */
    function adoptAttachments(sessionId) {
      knownAttachments.set(sessionId, new Set(attachmentIdsOf(sessionId)));
    }
    function nextNumber(sessionId) {
      const value = (counters.get(sessionId) ?? 0) + 1;
      counters.set(sessionId, value);
      return value;
    }
    function rememberImage(sessionId, record) {
      let table = registry.get(sessionId);
      if (table === undefined) {
        table = new Map();
        registry.set(sessionId, table);
      }
      table.set(record.n, record);
      while (table.size > REGISTRY_LIMIT) table.delete(table.keys().next().value);
    }
    function imageRecord(sessionId, n) {
      const table = registry.get(sessionId);
      return table === undefined ? null : table.get(n) ?? null;
    }

    /* ------------------------------------------------------------------ *
     * 删除同步：气泡被删掉 ⇒ 对应附件移出草稿（2 秒宽限，给撤销留门）。
     * 原生图片栏的图片项已被本插件 CSS 隐藏，气泡成了图片在草稿里的唯一
     * 入口；没有这层同步会出现「气泡没了、图还在发」的失控状态。
     * 宽限期内撤销（Ctrl+Z）或发送失败恢复草稿都会取消移除。
     * ------------------------------------------------------------------ */
    /** `${sessionId}|${attachmentId}` -> timeoutId：待移除的孤儿附件。 */
    const pendingRemovals = new Map();

    /** 从编辑器状态收集仍存活的 my-image 引用 id（纯内存遍历，不读 DOM）。 */
    function liveImageIds(state) {
      const ids = new Set();
      const map = state === null || state === undefined ? null : state._nodeMap;
      if (map === null || map === undefined || typeof map.values !== "function") return null;
      try {
        for (const node of map.values()) {
          if (node === null || node === undefined || typeof node !== "object") continue;
          if (node.__source !== SOURCE_NAME) continue;
          const parsed = parseRef(node.__ref);
          if (parsed !== null && parsed.id !== "") ids.add(parsed.id);
        }
      } catch (error) {
        return null; // 状态读失败时宁可不同步，也不错删。
      }
      return ids;
    }
    function cancelPending(key) {
      const timer = pendingRemovals.get(key);
      if (timer === undefined) return;
      clearTimeout(timer);
      pendingRemovals.delete(key);
    }
    function cancelPendingForSession(sessionId) {
      const prefix = sessionId + "|";
      for (const key of pendingRemovals.keys()) {
        if (key.startsWith(prefix)) cancelPending(key);
      }
    }
    function removeAttachmentNow(sessionId, record) {
      const shell = inputShellFor(sessionId);
      try {
        if (shell !== null && shell !== undefined && typeof shell.removeAttachment === "function") {
          shell.removeAttachment(record.id);
        } else {
          const entry = bridges.get(sessionId);
          const actions = entry === undefined ? null : entry.actions();
          if (actions !== null && actions !== undefined && typeof actions.removeAttachment === "function") {
            actions.removeAttachment(record.id);
          }
        }
      } catch (error) {
        // 移除失败不致命：附件留在原生列表里。
      }
      if (record.url !== null && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
        try {
          URL.revokeObjectURL(record.url);
        } catch (error) {
          // 预览 URL 回收失败无害。
        }
      }
      const table = registry.get(sessionId);
      if (table !== undefined && table.get(record.n) === record) table.delete(record.n);
    }
    function syncAttachments(sessionId, state) {
      const table = registry.get(sessionId);
      if (table === undefined || table.size === 0) return;
      const live = liveImageIds(state);
      if (live === null) return;
      for (const record of table.values()) {
        const key = sessionId + "|" + record.id;
        if (live.has(record.id)) {
          cancelPending(key);
          continue;
        }
        if (pendingRemovals.has(key)) continue;
        pendingRemovals.set(key, setTimeout(() => {
          pendingRemovals.delete(key);
          if (imageRecord(sessionId, record.n) !== record) return; // 记录已被替换
          removeAttachmentNow(sessionId, record);
        }, 2000));
      }
    }
    function isImageFile(file) {
      return file !== null && file !== undefined && typeof file.type === "string" && file.type.startsWith("image/");
    }
    /**
     * 一次粘贴/拖入之后的对账：
     *   新附件 id = 当前附件列表 − 基线（原生 addAttachments 追加在尾部）；
     *   与事件里的文件按下标一一配对（原生 createDrafts 保序）；
     *   数量对不上说明有文件被宿主限制拦下，本批放弃气泡（附件仍原生可用）。
     */
    function diffSession(sessionId, files) {
      const ids = attachmentIdsOf(sessionId);
      const known = knownAttachments.get(sessionId);
      if (known === undefined) {
        // 第一次见这个会话：尾巴上的 files.length 个是新的，其余收养进基线。
        if (files.length === 0 || ids.length < files.length) {
          knownAttachments.set(sessionId, new Set(ids));
          return;
        }
        knownAttachments.set(sessionId, new Set(ids.slice(0, ids.length - files.length)));
      }
      const baseline = knownAttachments.get(sessionId);
      const fresh = ids.filter((id) => !baseline.has(id));
      knownAttachments.set(sessionId, new Set(ids));
      if (fresh.length === 0 || files.length === 0) return;
      if (fresh.length !== files.length) {
        toast(translateFor(sessionId, "batchPartial"));
        return;
      }
      for (let i = 0; i < fresh.length; i += 1) {
        const file = files[i];
        if (!isImageFile(file)) continue;
        const record = {
          id: fresh[i],
          n: nextNumber(sessionId),
          url: typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null,
          name: typeof file.name === "string" && file.name !== "" ? file.name : fill(zh.imageMarker, i + 1)
        };
        rememberImage(sessionId, record);
        if (!insertImageChip(sessionId, record)) toast(translateFor(sessionId, "failed"));
      }
    }
    /** 原生收图多半同步完成；个别路径可能慢一拍，补一次延迟对账。 */
    function diffSessionSoon(sessionId, files) {
      diffSession(sessionId, files);
      setTimeout(() => {
        try {
          diffSession(sessionId, []);
        } catch (error) {
          // 重试失败不影响下一批。
        }
      }, 120);
    }
    function sessionIdOfTarget(target) {
      const content = closestFrom(target, CONTENT_SELECTOR);
      if (content !== null) {
        const sessionId = content.getAttribute("data-conversation-session");
        if (typeof sessionId === "string" && sessionId !== "") return sessionId;
      }
      const active = document.querySelector(CONTENT_SELECTOR + "[data-conversation-session]");
      return active === null ? null : active.getAttribute("data-conversation-session");
    }
    function filesOf(list) {
      if (list === null || list === undefined) return [];
      const out = [];
      for (let i = 0; i < list.length; i += 1) {
        const file = list[i];
        if (file !== null && file !== undefined) out.push(file);
      }
      return out;
    }
    function onPaste(event) {
      if (closestFrom(event.target, COMPOSER_SELECTOR) === null) return;
      const data = event.clipboardData;
      if (data === null || data === undefined) return;
      const files = filesOf(data.files);
      if (files.length === 0) return;
      const sessionId = sessionIdOfTarget(event.target);
      if (sessionId === null) return;
      diffSessionSoon(sessionId, files);
    }
    function onDrop(event) {
      const data = event.dataTransfer;
      if (data === null || data === undefined) return;
      const files = filesOf(data.files);
      if (files.length === 0) return;
      const sessionId = sessionIdOfTarget(event.target);
      if (sessionId === null) return;
      diffSessionSoon(sessionId, files);
    }

    /* ------------------------------------------------------------------ *
     * 悬停预览卡：document 级 mouseover 委托。
     * 不往宿主节点挂监听、不写属性、不用 MutationObserver ⇒ 无布线延迟。
     * ------------------------------------------------------------------ */
    let popover = null;
    let popoverHideTimer = null;
    let hoverHost = null;

    /** 气泡宿主 → 登记记录：标签文本里解析编号，再按会话查注册表。 */
    function chipInfoFor(element) {
      const label = typeof element.textContent === "string" ? element.textContent : "";
      const match = /(\d+)/.exec(label);
      if (match === null) return null;
      const n = Number(match[1]);
      if (!Number.isFinite(n)) return null;
      const sessionId = sessionIdOfTarget(element);
      if (sessionId === null) return null;
      return imageRecord(sessionId, n);
    }
    function cancelPopoverHide() {
      if (popoverHideTimer !== null) {
        clearTimeout(popoverHideTimer);
        popoverHideTimer = null;
      }
    }
    function hidePopover() {
      cancelPopoverHide();
      if (popover !== null) popover.style.display = "none";
    }
    function hidePopoverSoon() {
      cancelPopoverHide();
      popoverHideTimer = setTimeout(hidePopover, POPOVER_HIDE_MS);
    }
    function showPopover(anchor, record) {
      cancelPopoverHide();
      const doc = anchor.ownerDocument ?? document;
      let node = popover;
      if (node === null || node.isConnected === false) {
        node = el(doc, "div", { id: POPOVER_ID, "data-myi": "popover" });
        node.addEventListener("mouseenter", cancelPopoverHide);
        node.addEventListener("mouseleave", hidePopoverSoon);
        (doc.body ?? doc.documentElement).append(node);
        popover = node;
      }
      node.textContent = "";
      if (record.url !== null) {
        node.append(el(doc, "img", { class: "myi-pop-img", src: record.url, alt: record.name }));
      } else {
        node.append(el(doc, "div", { class: "myi-pop-missing", text: translateFor(null, "previewMissing") }));
      }
      node.append(el(doc, "div", { class: "myi-pop-name", text: fill(zh.imageMarker, record.n) + " " + record.name }));
      node.style.visibility = "hidden";
      node.style.display = "block";
      const rect = anchor.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      const left = clamp(rect.left + rect.width / 2 - box.width / 2, EDGE, window.innerWidth - box.width - EDGE);
      let top = rect.top - box.height - GAP;
      if (top < EDGE) top = rect.bottom + GAP;
      node.style.left = Math.round(left) + "px";
      node.style.top = Math.round(top) + "px";
      node.style.visibility = "";
    }
    function onChipOver(event) {
      if (drag !== null) return;
      const host = chipHostFrom(event.target);
      if (host !== null) {
        if (host === hoverHost) return;
        hoverHost = host;
        const info = chipInfoFor(host);
        if (info === null) {
          hoverHost = null;
          hidePopover();
          return;
        }
        showPopover(host, info);
        return;
      }
      if (hoverHost !== null) {
        hoverHost = null;
        hidePopoverSoon();
      }
    }

    /* ------------------------------------------------------------------ *
     * 气泡拖动（指针式，与 MY-Quote 同一套机制）：
     * mousedown 反查 Lexical 节点 key，越过阈值后 cloneNode 幻影跟随 +
     * 落点光标条，mouseup 在 editor.update 里摘除再插到落点。
     * 编号即绑定键，不随位置变化，所以移动后不需要重排附件。
     * ------------------------------------------------------------------ */
    let drag = null;
    const DRAG_THRESHOLD = 4;

    function editorForSession(sessionId) {
      const shell = inputShellFor(sessionId);
      const editor = shell === null || shell === undefined ? null : shell.editor;
      if (editor === null || editor === undefined) return null;
      if (typeof editor.update !== "function" || typeof editor.getEditorState !== "function") return null;
      if (editor._keyToDOMMap === null || editor._keyToDOMMap === undefined) return null;
      return editor;
    }
    function chipHostFrom(target) {
      return closestFrom(target, '[data-composer-chip="' + SOURCE_NAME + '"]');
    }
    function reverseKeyMap(editor) {
      const back = new Map();
      try {
        for (const pair of editor._keyToDOMMap) {
          if (pair === null || pair === undefined || pair.length < 2) continue;
          if (pair[1] !== null && pair[1] !== undefined && back.has(pair[1]) === false) back.set(pair[1], pair[0]);
        }
      } catch (error) {
        return null;
      }
      return back;
    }
    function keyForDom(back, domNode) {
      let node = domNode;
      while (node !== null && node !== undefined) {
        const key = back.get(node);
        if (key !== undefined) return key;
        node = node.parentNode === undefined ? null : node.parentNode;
      }
      return undefined;
    }
    function anchorForPoint(editor, map, range, event, card) {
      if (range !== null && range !== undefined) {
        const back = reverseKeyMap(editor);
        if (back !== null) {
          let domNode = range.startContainer;
          const domOffset = typeof range.startOffset === "number" ? range.startOffset : 0;
          while (domNode !== null && domNode !== undefined) {
            const key = keyForDom(back, domNode);
            if (key !== undefined) {
              const node = map.get(key);
              if (node !== null && node !== undefined) return anchorForNode(node, domNode, domOffset, event);
            }
            domNode = domNode.parentNode === undefined ? null : domNode.parentNode;
          }
        }
      }
      const root = map.get("root");
      if (root === null || root === undefined || typeof root.getChildren !== "function") return null;
      const children = root.getChildren();
      if (children.length === 0) return null;
      const last = children[children.length - 1];
      if (last === null || last === undefined || typeof last.append !== "function") return null;
      return { node: last, place: (chip) => last.append(chip) };
    }
    function anchorForNode(node, domNode, domOffset, event) {
      if (typeof node.splitText === "function" && typeof node.getTextContent === "function") {
        let size = 0;
        try {
          size = typeof node.getTextContentSize === "function" ? node.getTextContentSize() : String(node.getTextContent()).length;
        } catch (error) {
          size = 0;
        }
        const offset = clamp(domOffset, 0, size);
        if (offset <= 0) return { node, place: (chip) => node.insertBefore(chip) };
        if (offset >= size) return { node, place: (chip) => node.insertAfter(chip) };
        return {
          node,
          place: (chip) => {
            const parts = node.splitText(offset);
            const left = Array.isArray(parts) && parts.length > 0 ? parts[0] : node;
            left.insertAfter(chip);
          }
        };
      }
      if (typeof node.getChildren === "function") {
        return {
          node,
          place: (chip) => {
            const children = node.getChildren();
            if (domOffset >= children.length) {
              node.append(chip);
              return;
            }
            const target = children[domOffset];
            if (target === chip || target === null || target === undefined || typeof target.insertBefore !== "function") return;
            target.insertBefore(chip);
          }
        };
      }
      const element = elementOf(domNode);
      if (element === null || typeof element.getBoundingClientRect !== "function") return null;
      const rect = element.getBoundingClientRect();
      const after = event.clientX > rect.left + rect.width / 2;
      return {
        node,
        place: (chip) => {
          if (node === chip) return;
          if (after) node.insertAfter(chip);
          else node.insertBefore(chip);
        }
      };
    }
    function moveChip(editor, key, range, event, card) {
      let moved = false;
      try {
        editor.update(() => {
          const state = editor.getEditorState();
          const map = state === null || state === undefined ? null : state._nodeMap;
          if (map === null || map === undefined || typeof map.get !== "function") return;
          const chip = map.get(key);
          if (chip === null || chip === undefined || typeof chip.remove !== "function") return;
          const anchor = anchorForPoint(editor, map, range, event, card);
          if (anchor === null || anchor.node === chip) return;
          chip.remove();
          anchor.place(chip);
          moved = true;
          try {
            if (typeof chip.selectNext === "function") chip.selectNext(0, 0);
          } catch (error) {
            // 光标位置不强求。
          }
        });
      } catch (error) {
        moved = false;
      }
      return moved;
    }
    function onChipPointerDown(event) {
      if (event.button !== 0) return;
      const host = chipHostFrom(event.target);
      if (host === null) return;
      const sessionId = sessionIdOfTarget(host);
      const editor = sessionId === null ? null : editorForSession(sessionId);
      if (editor === null) return;
      const back = reverseKeyMap(editor);
      const key = back === null ? null : keyForDom(back, host);
      if (key === null || key === undefined) return;
      drag = { sessionId, editor, key, host, startX: event.clientX, startY: event.clientY, active: false, ghost: null, caret: null };
      event.preventDefault();
    }
    function dragSessionOf(target) {
      const sessionId = sessionIdOfTarget(target);
      return sessionId;
    }
    function onChipPointerMove(event) {
      if (drag === null) return;
      if (!drag.active) {
        if (Math.abs(event.clientX - drag.startX) < DRAG_THRESHOLD && Math.abs(event.clientY - drag.startY) < DRAG_THRESHOLD) return;
        if ((event.buttons & 1) === 0) {
          drag = null;
          return;
        }
        drag.active = true;
        hidePopover();
        hoverHost = null;
        drag.ghost = makeGhost(drag.host);
        drag.caret = makeCaret(drag.host);
      }
      event.preventDefault();
      positionGhost(drag.ghost, event.clientX, event.clientY);
      updateCaret(drag, event);
    }
    function onChipPointerUp(event) {
      if (drag === null) return;
      const active = drag;
      drag = null;
      cleanupDragVisuals(active);
      if (!active.active) return;
      event.preventDefault();
      const sessionId = dragSessionOf(event.target);
      if (sessionId === null || sessionId !== active.sessionId) return;
      const card = closestFrom(event.target, CARD_SELECTOR);
      const doc = card !== null && card.ownerDocument !== undefined ? card.ownerDocument : document;
      let range = null;
      try {
        if (typeof doc.caretRangeFromPoint === "function") {
          range = doc.caretRangeFromPoint(event.clientX, event.clientY);
        } else if (typeof doc.caretPositionFromPoint === "function") {
          const pos = doc.caretPositionFromPoint(event.clientX, event.clientY);
          if (pos !== null) {
            range = doc.createRange();
            range.setStart(pos.offsetNode, pos.offset);
            range.collapse(true);
          }
        }
      } catch (error) {
        range = null;
      }
      if (moveChip(active.editor, active.key, range, event, card)) focusComposerKeep(active.sessionId);
    }
    function cancelDrag() {
      if (drag === null) return;
      const active = drag;
      drag = null;
      cleanupDragVisuals(active);
    }
    function cleanupDragVisuals(state) {
      if (state.ghost !== null && state.ghost.isConnected) state.ghost.remove();
      if (state.caret !== null && state.caret.isConnected) state.caret.remove();
    }
    function makeGhost(host) {
      const doc = host.ownerDocument ?? document;
      const ghost = host.cloneNode(true);
      ghost.setAttribute("data-myi", "ghost");
      ghost.style.position = "fixed";
      ghost.style.margin = "0";
      ghost.style.pointerEvents = "none";
      ghost.style.opacity = "0.85";
      ghost.style.zIndex = "2147483003";
      (doc.body ?? doc.documentElement).append(ghost);
      return ghost;
    }
    function positionGhost(ghost, x, y) {
      if (ghost === null) return;
      ghost.style.left = Math.round(x + 12) + "px";
      ghost.style.top = Math.round(y + 12) + "px";
    }
    function makeCaret(host) {
      const doc = host.ownerDocument ?? document;
      const caret = el(doc, "div", { "data-myi": "caret" });
      caret.style.position = "fixed";
      caret.style.width = "2px";
      caret.style.pointerEvents = "none";
      caret.style.zIndex = "2147483003";
      caret.style.borderRadius = "1px";
      caret.style.background = "var(--dsw-alias-brand-primary,#1a1d26)";
      caret.style.display = "none";
      (doc.body ?? doc.documentElement).append(caret);
      return caret;
    }
    function updateCaret(state, event) {
      const caret = state.caret;
      if (caret === null) return;
      const sessionId = dragSessionOf(event.target);
      if (sessionId === null || sessionId !== state.sessionId) {
        caret.style.display = "none";
        return;
      }
      const doc = document;
      let range = null;
      try {
        if (typeof doc.caretRangeFromPoint === "function") {
          range = doc.caretRangeFromPoint(event.clientX, event.clientY);
        } else if (typeof doc.caretPositionFromPoint === "function") {
          const pos = doc.caretPositionFromPoint(event.clientX, event.clientY);
          if (pos !== null) {
            range = doc.createRange();
            range.setStart(pos.offsetNode, pos.offset);
            range.collapse(true);
          }
        }
      } catch (error) {
        range = null;
      }
      if (range === null) {
        caret.style.display = "none";
        return;
      }
      const anchorEl = elementOf(range.startContainer);
      if (anchorEl === null || closestFrom(anchorEl, COMPOSER_SELECTOR) === null) {
        caret.style.display = "none";
        return;
      }
      let rect = null;
      try {
        const rects = range.getClientRects();
        rect = rects !== null && rects.length > 0 ? rects[0] : range.getBoundingClientRect();
      } catch (error) {
        rect = null;
      }
      if (rect === null || (rect.height === 0 && rect.width === 0)) {
        caret.style.display = "none";
        return;
      }
      caret.style.display = "block";
      caret.style.left = Math.round(rect.left - 1) + "px";
      caret.style.top = Math.round(rect.top) + "px";
      caret.style.height = Math.max(10, Math.round(rect.height)) + "px";
    }

    /* ------------------------------------------------------------------ *
     * 提示条
     * ------------------------------------------------------------------ */
    let toastTimer = null;
    function toast(text) {
      if (typeof document === "undefined") return;
      let node = document.getElementById(TOAST_ID);
      if (node === null) {
        node = el(document, "div", { id: TOAST_ID, "data-myi": "toast", role: "status" });
        (document.body ?? document.documentElement).append(node);
      }
      node.textContent = text;
      node.style.display = "block";
      if (toastTimer !== null) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toastTimer = null;
        if (node.isConnected) node.remove();
      }, TOAST_MS);
    }

    /* ------------------------------------------------------------------ *
     * 全局监听（冒泡阶段观察，不拦截任何事件）
     * ------------------------------------------------------------------ */
    let listenersAttached = false;

    function onKeyDown(event) {
      if (event.key === "Escape" && event.isComposing !== true && drag !== null) {
        cancelDrag();
        return;
      }
      if (event.key !== "Escape" || event.isComposing === true) return;
      hidePopover();
    }
    function onScrollOrResize() {
      hidePopover();
    }
    function installChipDrag() {
      if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
      document.addEventListener("mousedown", onChipPointerDown, true);
      document.addEventListener("mousemove", onChipPointerMove, true);
      document.addEventListener("mouseup", onChipPointerUp, true);
      document.addEventListener("mouseover", onChipOver, true);
    }
    function uninstallChipDrag() {
      if (typeof document === "undefined" || typeof document.removeEventListener !== "function") return;
      document.removeEventListener("mousedown", onChipPointerDown, true);
      document.removeEventListener("mousemove", onChipPointerMove, true);
      document.removeEventListener("mouseup", onChipPointerUp, true);
      document.removeEventListener("mouseover", onChipOver, true);
      cancelDrag();
      hoverHost = null;
      hidePopover();
      if (popover !== null && popover.isConnected) popover.remove();
      popover = null;
    }
    function attachListeners() {
      if (listenersAttached) return;
      if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
      listenersAttached = true;
      document.addEventListener("paste", onPaste, false);
      document.addEventListener("drop", onDrop, false);
      document.addEventListener("keydown", onKeyDown, true);
      document.addEventListener("scroll", onScrollOrResize, true);
      installChipDrag();
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        window.addEventListener("resize", onScrollOrResize);
      }
    }
    function detachListeners() {
      if (!listenersAttached) return;
      listenersAttached = false;
      uninstallChipDrag();
      document.removeEventListener("paste", onPaste, false);
      document.removeEventListener("drop", onDrop, false);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", onScrollOrResize, true);
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("resize", onScrollOrResize);
      }
      const toastNode = document.getElementById(TOAST_ID);
      if (toastNode !== null) toastNode.remove();
    }

    /* ------------------------------------------------------------------ *
     * 样式安装
     * ------------------------------------------------------------------ */
    function installStyle() {
      if (typeof document === "undefined") return;
      if (document.getElementById(STYLE_ID) !== null) return;
      const style = el(document, "style", { id: STYLE_ID, "data-myi": "style" });
      style.textContent = STYLE_TEXT;
      (document.head ?? document.documentElement).append(style);
    }
    function uninstallStyle() {
      if (typeof document === "undefined") return;
      const style = document.getElementById(STYLE_ID);
      if (style !== null) style.remove();
    }

    /* ------------------------------------------------------------------ *
     * 共享运行时的引用计数（宿主会多次挂载本插件）
     * ------------------------------------------------------------------ */
    let runtimeHolders = 0;
    function holdRuntime() {
      runtimeHolders += 1;
      if (runtimeHolders > 1) return;
      installStyle();
      attachListeners();
    }
    function releaseRuntime() {
      runtimeHolders = Math.max(0, runtimeHolders - 1);
      if (runtimeHolders > 0) return;
      detachListeners();
      uninstallStyle();
    }

    /* ------------------------------------------------------------------ *
     * Slot 组件：conversation.input.overlay 上的 Bridge
     * 不渲染任何可见内容，只为每个会话留下 inputActions 与 t()，
     * 并把该会话已有的附件收养进基线（不为存量附件补气泡）。
     * ------------------------------------------------------------------ */
    function Bridge(props) {
      const latest = react.useRef(props);
      latest.current = props;
      react.useEffect(() => {
        const sessionId = props.sessionId;
        if (typeof sessionId !== "string" || sessionId === "") return undefined;
        const entry = {
          actions: () => {
            const actions = latest.current === null || latest.current === undefined ? null : latest.current.inputActions;
            return actions === null || actions === undefined ? null : actions;
          },
          translate: (key) => {
            const t = latest.current === null || latest.current === undefined ? null : latest.current.t;
            if (typeof t === "function") {
              const value = t(key);
              if (typeof value === "string" && value !== "") return value;
            }
            return zh[key] === undefined ? key : zh[key];
          }
        };
        bridges.set(sessionId, entry);
        adoptAttachments(sessionId);
        // 删除同步：编辑器每次更新后对照存活气泡与登记表，孤儿附件延迟移除。
        let detachSync = null;
        let syncRetryA = 0;
        let syncRetryB = 0;
        const attachSync = () => {
          if (detachSync !== null) return true;
          const editor = editorForSession(sessionId);
          if (editor === null || typeof editor.registerUpdateListener !== "function") return false;
          detachSync = editor.registerUpdateListener((payload) => {
            try {
              const state = payload !== null && typeof payload === "object" && payload.editorState !== undefined
                ? payload.editorState
                : editor.getEditorState();
              syncAttachments(sessionId, state);
            } catch (error) {
              // 同步异常不影响输入。
            }
          });
          return true;
        };
        if (!attachSync()) {
          syncRetryA = setTimeout(attachSync, 300);
          syncRetryB = setTimeout(attachSync, 1200);
        }
        return () => {
          if (bridges.get(sessionId) === entry) bridges.delete(sessionId);
          clearTimeout(syncRetryA);
          clearTimeout(syncRetryB);
          if (detachSync !== null) {
            try {
              detachSync();
            } catch (error) {
              // 反注册失败无害。
            }
            detachSync = null;
          }
          cancelPendingForSession(sessionId);
        };
      }, [props.sessionId]);
      return null;
    }

    /* ------------------------------------------------------------------ *
     * 插件入口
     * ------------------------------------------------------------------ */
    function apply(ctx) {
      if (typeof document === "undefined") return;
      pluginCtx = ctx;
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "my-image-chip: dictionaries");
      ctx.effect(() => {
        holdSource();
        return releaseSource;
      }, "my-image-chip: reference source");
      ctx.effect(() => {
        holdRuntime();
        return releaseRuntime;
      }, "my-image-chip: runtime");
      ctx.slots.inject("conversation.input.overlay", () =>
        ctx.slots.register(
          {
            name: "conversation.input.overlay",
            id: "my-image-chip.bridge",
            order: 10,
            locale: NS,
            inject: () => ({})
          },
          Bridge
        )
      );
    }

    return { inject: ["slots", "locale"], apply };
  }
});
