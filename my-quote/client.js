/**
 * MY-Quote 划词引用 — Client 半边（Host 半边是空 apply）。
 *
 * 两条引用路径：
 *   划词 → 浮动条「引用到输入框」→ 引用以原生 reference 气泡落进草稿最上方，
 *          悬停气泡显示完整引用内容；
 *   划词 → 浮动条「新开分叉」→ fork 当前会话并在主会话区打开（DSH 右侧栏的
 *          subagentchat 页签只接受 origin==="subagent" 的委派子会话，普通 fork
 *          会被 subagent/unauthorized 拒绝），引用预填进分叉的输入框（不发送）；
 *          分叉记录进右侧栏「引用分叉」管理页。
 *
 * 实现要点（均沿袭 dsh-client-ui-quote 验证过的宿主 API）：
 *   - 气泡 = inputTriggers 注册的引用源 + conversation.input.shell(sessionId).insertReference；
 *   - 悬停卡片 = 按气泡渲染文本在 [data-composer-card] 内匹配 DOM 节点后挂 mouseenter；
 *   - 浮动条是 document 级单例，不依赖任何 slot 挂载存活；
 *   - conversation.input.overlay 上的 Bridge 组件只为每个会话留下 inputActions 与 t()。
 */
window.__ModuleLoader__.load({
  id: "my-quote",
  factory(require) {
    const react = require("react");
    const h = react.createElement;

    /* ------------------------------------------------------------------ *
     * 文案
     * ------------------------------------------------------------------ */
    const NS = "my-quote";
    const zh = {
      addToChat: "引用到输入框",
      sideFork: "新开分叉",
      copy: "复制",
      copied: "已复制",
      failed: "插入失败，请重试",
      forkFailed: "分叉没有打开，请重试",
      forkDraftFailed: "分叉已打开，但引用没能写进它的输入框",
      managerTitle: "引用分叉",
      managerGuide: "本会话由划词引用创建的分叉：打开或归档",
      managerEmpty: "这个会话还没有引用分叉",
      managerCount: "{n} 个分叉",
      managerOpen: "打开",
      managerArchive: "归档",
      managerArchived: "已归档",
      forkPrefix: "└ 引用："
    };
    const en = {
      addToChat: "Quote to composer",
      sideFork: "Fork with quote",
      copy: "Copy",
      copied: "Copied",
      failed: "Could not insert, try again",
      forkFailed: "The fork did not open, try again",
      forkDraftFailed: "Fork opened, but the quote could not be written into it",
      managerTitle: "Quote forks",
      managerGuide: "Forks created from selections in this session: open or archive them",
      managerEmpty: "No quote forks in this session yet",
      managerCount: "{n} forks",
      managerOpen: "Open",
      managerArchive: "Archive",
      managerArchived: "Archived",
      forkPrefix: "└ Quote: "
    };

    /* ------------------------------------------------------------------ *
     * 常量
     * ------------------------------------------------------------------ */
    const STYLE_ID = "myq-style";
    const BAR_ID = "myq-bar";
    const POPOVER_ID = "myq-popover";
    const TOAST_ID = "myq-toast";
    const CONTENT_SELECTOR = "[data-conversation-content]";
    const CARD_SELECTOR = "[data-composer-card]";
    const COMPOSER_SELECTOR = "[data-composer-input]";
    /** 引用源名字：触发符用输入面检测不到的 "#"，气泡只由本插件插入。 */
    const SOURCE_NAME = "my-quote";
    const SOURCE_TRIGGER = "#";
    const SETTLE_MS = 180;
    const TOAST_MS = 1800;
    const POPOVER_HIDE_MS = 140;
    const EDGE = 8;
    const GAP = 8;
    const CHIP_KEY = "my-quote:v1:chips";
    const CHIP_LIMIT = 100;
    const FORK_KEY = "my-quote:v1:forks";
    const FORK_LIMIT = 50;
    const TAB_ID = "my-quote/forks";
    const TAB_KIND = "my-quote-forks";

    /* ------------------------------------------------------------------ *
     * 样式（全部走 DSH 原生 --dsw-alias-* 主题 token，跟随浅色/深色：
     * 浮动条=button-floating-fill，悬停卡=tooltip-bg，提示=toast-bg）
     * ------------------------------------------------------------------ */
    const STYLE_TEXT = `
#${BAR_ID}{position:fixed;z-index:2147483000;display:none;box-sizing:border-box;padding:4px;
background:var(--dsw-alias-button-floating-fill,#ffffff);color:var(--dsw-alias-label-primary,#1a1d26);
border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06));border-radius:10px;
box-shadow:0 8px 24px rgba(0,0,0,.16);font-family:inherit;font-size:13px;line-height:1.45;-webkit-app-region:no-drag}
#${BAR_ID} .myq-row{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;
padding:6px 10px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit;
text-align:left;white-space:nowrap;cursor:default}
#${BAR_ID} .myq-row:hover,#${BAR_ID} .myq-row:focus-visible{background:var(--dsw-alias-button-floating-hover,color-mix(in srgb,currentColor 8%,transparent));outline:none}
#${BAR_ID} .myq-row[data-action="fork"]{color:var(--dsw-alias-brand-primary,#1a1d26)}
#${POPOVER_ID}{position:fixed;z-index:2147483001;display:none;box-sizing:border-box;max-width:420px;max-height:300px;overflow:auto;
padding:10px 12px;background:var(--dsw-alias-tooltip-bg,#26282e);color:var(--dsw-static-neutral-bluish-00,#f2f3f5);
border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));border-radius:10px;
box-shadow:0 10px 30px rgba(0,0,0,.3);font-family:inherit;font-size:13px;line-height:20px;-webkit-app-region:no-drag}
#${POPOVER_ID} .myq-pop-quote{white-space:pre-wrap;overflow-wrap:anywhere}
#${TOAST_ID}{position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:2147483002;
padding:6px 12px;border-radius:8px;background:var(--dsw-alias-toast-bg,#26282e);
color:var(--dsw-alias-toast-label,#ffffff);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));
font-family:inherit;font-size:12.5px;box-shadow:0 6px 20px rgba(0,0,0,.24);-webkit-app-region:no-drag}
[data-composer-chip="${SOURCE_NAME}"]{cursor:grab}
[data-composer-chip="${SOURCE_NAME}"]:active{cursor:grabbing}
/* 输入框高度抖动缓解：为滚动区恒定预留滚动条槽位，消除"滚动条出现→可用宽度变→
   重折行→高度变→滚动条消失"的边界振荡。原生类名 .RlGAzG_scroll 为打包哈希，
   版本升级后可能失效，失效的最坏结果只是回到原生行为。 */
[data-composer-card] .RlGAzG_scroll{scrollbar-gutter:stable}
.myq-list{box-sizing:border-box;display:flex;flex-direction:column;gap:8px;height:100%;padding:10px 12px;
font-size:12.5px;line-height:1.55;color:inherit;-webkit-app-region:no-drag}
.myq-list-head{display:flex;align-items:center;gap:8px}
.myq-list-count{opacity:.7}
.myq-list-body{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:8px}
.myq-list-note{opacity:.65;padding:10px 2px}
.myq-fork{display:flex;flex-direction:column;gap:3px;padding:7px 9px;border-radius:8px;
border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));background:transparent}
.myq-fork:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 4%,transparent))}
.myq-fork[data-archived="true"]{opacity:.55}
.myq-fork-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.myq-fork-excerpt{opacity:.75;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.myq-fork-foot{display:flex;align-items:center;gap:8px;font-size:11px;margin-top:2px}
.myq-fork-time{opacity:.6}
.myq-fork-archived{color:var(--dsw-alias-brand-primary,#1a1d26)}
.myq-btn{padding:2px 8px;border-radius:6px;font:inherit;font-size:11.5px;cursor:pointer;
border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.34));background:transparent;color:inherit}
.myq-btn:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,currentColor 8%,transparent))}
.myq-fork-foot .myq-btn:first-of-type{margin-left:auto}
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
    function flat(value) {
      return String(value ?? "").replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    }
    function clip(value, max) {
      return value.length > max ? value.slice(0, max - 1) + "…" : value;
    }
    function blockLines(text) {
      if (typeof text !== "string" || text.trim() === "") return [];
      const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+$/, ""));
      while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
      while (lines.length > 0 && lines[0].trim() === "") lines.shift();
      return lines;
    }
    function firstLineOf(text) {
      const lines = blockLines(text);
      return lines.length === 0 ? "" : lines[0].trim();
    }
    /** 引用的 Markdown 形态：发给模型的文本与纯文本兜底共用。 */
    function quoteMarkdown(text) {
      return blockLines(text).map((line) => (line.trim() === "" ? ">" : "> " + line)).join("\n");
    }
    function chipLabel(text) {
      return clip(flat(text), 48);
    }
    function formatTime(at) {
      try {
        return new Date(at).toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      } catch (error) {
        return "";
      }
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
    function translate(key) {
      return translateFor(state.found === null ? null : state.found.sessionId, key);
    }

    /* ------------------------------------------------------------------ *
     * 引用源（发送时宿主回调 codec.serialize 取模型文本，必须先注册再插气泡）
     * ------------------------------------------------------------------ */
    const quoteSource = {
      trigger: SOURCE_TRIGGER,
      name: SOURCE_NAME,
      showGroupTitle: false,
      candidates: () => [],
      codec: {
        clipboardText: (ref) => ref,
        serialize: (ref) => Promise.resolve(String(ref))
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
        const disposer = service.registerSource(quoteSource);
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
    /** 纯文本兜底：引用以 Markdown 引用块写到草稿光标处。 */
    function insertPayload(entry, text) {
      const actions = entry.actions();
      if (actions === null || actions === undefined || typeof actions.captureInsertion !== "function" || typeof actions.insertText !== "function") return false;
      try {
        const span = actions.captureInsertion();
        return actions.insertText(text, span) === true;
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
    function focusComposerAtEnd() {
      const target = composerEditor();
      if (target === null || typeof target.focus !== "function") return;
      try {
        target.focus({ preventScroll: true });
        if (typeof document.getSelection !== "function" || typeof document.createRange !== "function") return;
        const selection = document.getSelection();
        if (selection === null || typeof selection.addRange !== "function" || typeof selection.removeAllRanges !== "function") return;
        const range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      } catch (error) {
        // 光标留在浏览器放的位置不算失败。
      }
    }
    /** Lexical 原生聚焦：editor.focus() 内放下 draft 末尾选区，与 Lexical 选区同步无冲突。 */
    function focusEditorAtEnd(sessionId) {
      const shell = inputShellFor(sessionId);
      const editor = shell === null || shell === undefined ? null : shell.editor;
      if (editor === null || editor === undefined || typeof editor.focus !== "function") return false;
      try {
        editor.focus(() => {
          try {
            const state = editor.getEditorState();
            const map = state === null || state === undefined ? null : state._nodeMap;
            const root = map === null || map === undefined ? null : map.get("root");
            if (root !== null && root !== undefined && typeof root.selectEnd === "function") root.selectEnd();
          } catch (error) {
            // 选区放置失败仍保留聚焦本身。
          }
        });
        return true;
      } catch (error) {
        return false;
      }
    }
    /** 插入后 React 会重渲染输入框并夺走焦点：立即聚焦一次，再延迟补聚焦。 */
    function focusComposerSoon(sessionId) {
      if (typeof sessionId !== "string" || sessionId === "" || !focusEditorAtEnd(sessionId)) focusComposerAtEnd();
      for (const delay of [60, 180]) {
        setTimeout(() => {
          try {
            const target = composerEditor();
            if (target === null || typeof document === "undefined") return;
            const active = document.activeElement;
            if (active === target || (active !== null && typeof target.contains === "function" && target.contains(active))) return;
            if (typeof sessionId === "string" && sessionId !== "") {
              if (focusEditorAtEnd(sessionId)) return;
            }
            focusComposerAtEnd();
          } catch (error) {
            // 聚焦失败不打扰用户。
          }
        }, delay);
      }
    }
    /**
     * 插一个引用气泡到草稿光标处：shell.insertReference 直达，
     * slash/input-insert-reference 事件兜底，再退化为纯文本引用块。
     * 插入后聚焦并把光标移到末尾 ⇒ 连续引用时新气泡自然排在旧气泡下方。
     */
    function insertChip(sessionId, text) {
      if (!ensureSource() || pluginCtx === null) return false;
      const shell = inputShellFor(sessionId);
      const entry = insertionFace(sessionId, shell);
      if (entry === null) return false;
      const model = "\n" + quoteMarkdown(text) + "\n\n";
      const attachment = {
        source: SOURCE_NAME,
        ref: model,
        label: chipLabel(text),
        appearance: "session",
        clipboardText: model
      };
      const actions = entry.actions();
      if (actions === null || actions === undefined || typeof actions.captureInsertion !== "function") {
        return insertPayload(entry, model);
      }
      const span = actions.captureInsertion();
      if (shell !== null && shell !== undefined && typeof shell.insertReference === "function") {
        try {
          if (shell.insertReference(attachment, span) === true) {
            rememberChip(text, sessionId);
            focusComposerSoon(sessionId);
            return true;
          }
        } catch (error) {
          // 走事件兜底。
        }
      }
      const actx = sessionActx(sessionId);
      if (dispatchInputEvent(actx, "slash/input-insert-reference", { reference: attachment, span })) {
        rememberChip(text, sessionId);
        focusComposerSoon(sessionId);
        return true;
      }
      return insertPayload(entry, model);
    }

    /* ------------------------------------------------------------------ *
     * 气泡索引 + 悬停卡片
     * ------------------------------------------------------------------ */
    const chipIndex = new Map();
    const persistedChips = new Map();
    let popover = null;
    let popoverHideTimer = null;
    /** 悬停/拖动全走 document 级事件委托：不往宿主节点挂监听、不写属性。
     *  这是当前悬停的气泡宿主。 */
    let hoverHost = null;

    function loadPersistedChips() {
      try {
        const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(CHIP_KEY);
        if (typeof raw !== "string" || raw === "") return;
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object") return;
        for (const label of Object.keys(parsed)) {
          const entry = parsed[label];
          if (entry === null || typeof entry !== "object" || typeof entry.text !== "string") continue;
          persistedChips.set(label, {
            text: entry.text,
            sessionId: typeof entry.sessionId === "string" ? entry.sessionId : null,
            at: typeof entry.at === "number" ? entry.at : 0
          });
        }
      } catch (error) {
        // 坏存储不构成插件故障。
      }
    }
    function savePersistedChips() {
      const plain = {};
      for (const [label, entry] of persistedChips) plain[label] = entry;
      try {
        if (typeof localStorage !== "undefined") localStorage.setItem(CHIP_KEY, JSON.stringify(plain));
      } catch (error) {
        // 存储满了不拖累输入框。
      }
    }
    function rememberChip(text, sessionId) {
      const label = chipLabel(text);
      if (label === "") return;
      const info = { text, sessionId, at: Date.now() };
      chipIndex.delete(label);
      chipIndex.set(label, info);
      while (chipIndex.size > CHIP_LIMIT) chipIndex.delete(chipIndex.keys().next().value);
      persistedChips.delete(label);
      persistedChips.set(label, info);
      while (persistedChips.size > CHIP_LIMIT) persistedChips.delete(persistedChips.keys().next().value);
      savePersistedChips();
    }
    function chipInfoFor(element) {
      const text = flat(element.textContent);
      if (text === "") return null;
      const exact = chipIndex.get(text);
      if (exact !== undefined) return exact;
      const remembered = persistedChips.get(text);
      if (remembered !== undefined) return remembered;
      // 宿主可能给气泡渲染一个前导符号，剥掉再对一次。
      const bare = text.replace(/^[❝❞•·"']/u, "").replace(/^\s+/u, "");
      if (bare === text) return null;
      return chipIndex.get(bare) ?? persistedChips.get(bare) ?? null;
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
    function showPopover(anchor, info) {
      cancelPopoverHide();
      const doc = anchor.ownerDocument ?? document;
      let node = popover;
      if (node === null || node.isConnected === false) {
        node = el(doc, "div", { id: POPOVER_ID, "data-myq": "popover" });
        node.addEventListener("mouseenter", cancelPopoverHide);
        node.addEventListener("mouseleave", hidePopoverSoon);
        (doc.body ?? doc.documentElement).append(node);
        popover = node;
      }
      node.textContent = "";
      node.append(el(doc, "div", { class: "myq-pop-quote", text: info.text }));
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
    /* ------------------------------------------------------------------ *
     * 悬停卡片：document 级 mouseover 委托。
     * 不往宿主节点挂监听、不写属性、不用 MutationObserver ⇒ 无布线延迟，
     * React 复用/重建气泡节点也无所谓（每次悬停按渲染文本重新解析索引）。
     * ------------------------------------------------------------------ */
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
     * 气泡拖动（指针式）：ReferenceChipNode 是 Lexical 装饰节点，shell.editor
     * 公开可拿 ⇒ mousedown 反查节点 key，越过阈值后用 cloneNode 幻影跟随 +
     * 落点光标条提示，mouseup 时在 editor.update 里摘除再插到落点。
     * （Lexical 对 contenteditable=false 节点 mousedown 做 preventDefault，
     *   HTML5 原生拖拽起不来，所以不用 dragstart/drop。）
     * 全程只用节点实例方法（remove/insertBefore/insertAfter/splitText/append），
     * 不 import lexical；DOM→节点靠 editor._keyToDOMMap 反向查找。
     * ------------------------------------------------------------------ */
    /** 指针式拖动状态：mousedown 记起点，越过阈值才激活（不吞掉普通点击）。 */
    let drag = null;
    const DRAG_THRESHOLD = 4;

    /** shell.editor（Lexical 实例）。拿不到就只放弃拖动，其余功能不受影响。 */
    function editorForSession(sessionId) {
      const shell = inputShellFor(sessionId);
      const editor = shell === null || shell === undefined ? null : shell.editor;
      if (editor === null || editor === undefined) return null;
      if (typeof editor.update !== "function" || typeof editor.getEditorState !== "function") return null;
      if (editor._keyToDOMMap === null || editor._keyToDOMMap === undefined) return null;
      return editor;
    }
    /** 事件目标命中的本插件气泡宿主（Lexical createDOM 出的 span）。 */
    function chipHostFrom(target) {
      return closestFrom(target, '[data-composer-chip="' + SOURCE_NAME + '"]');
    }
    /** _keyToDOMMap 反转一次：DOM 节点（含 Text）→ Lexical node key。 */
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
    /**
     * 把 DOM 落点翻译成可插位置，返回 { node, place(chip) }；落空返回 null。
     * 气泡是装饰节点、不占文本字符 ⇒ 摘除它不会挪移任何文本节点的偏移。
     */
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
      // 兜底：落点在卡片内但没命中任何节点 ⇒ 追加到最后一个段落末尾。
      const root = map.get("root");
      if (root === null || root === undefined || typeof root.getChildren !== "function") return null;
      const children = root.getChildren();
      if (children.length === 0) return null;
      const last = children[children.length - 1];
      if (last === null || last === undefined || typeof last.append !== "function") return null;
      return { node: last, place: (chip) => last.append(chip) };
    }
    function anchorForNode(node, domNode, domOffset, event) {
      // 文本节点：按字符偏移，必要时分拆。
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
      // 元素节点（段落/根）：按子序号。
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
      // 装饰节点：按横向中点选前/后。
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
    /** 按下气泡：记下会话/节点 key/起点。preventDefault 阻止 Lexical 抢占（文本选区）。 */
    function onChipPointerDown(event) {
      if (event.button !== 0) return;
      const host = chipHostFrom(event.target);
      if (host === null) return;
      const content = closestFrom(host, CONTENT_SELECTOR);
      const sessionId = content === null ? null : content.getAttribute("data-conversation-session");
      const editor = sessionId === null ? null : editorForSession(sessionId);
      if (editor === null) return;
      const back = reverseKeyMap(editor);
      const key = back === null ? null : keyForDom(back, host);
      if (key === null || key === undefined) return;
      drag = { sessionId, editor, key, host, startX: event.clientX, startY: event.clientY, active: false, ghost: null, caret: null };
      event.preventDefault();
    }
    function dragSessionOf(target) {
      const card = closestFrom(target, CARD_SELECTOR);
      if (card === null) return null;
      const content = closestFrom(card, CONTENT_SELECTOR);
      return content === null ? null : content.getAttribute("data-conversation-session");
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
      if (moveChip(active.editor, active.key, range, event, card)) focusComposerSoon(active.sessionId);
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
    /** 跟随光标的浮动幻影（气泡克隆体，pointer-events:none ⇒ 不参与事件命中）。 */
    function makeGhost(host) {
      const doc = host.ownerDocument ?? document;
      const ghost = host.cloneNode(true);
      ghost.setAttribute("data-myq", "ghost");
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
    /** 落点光标条（2px 竖线）。 */
    function makeCaret(host) {
      const doc = host.ownerDocument ?? document;
      const caret = el(doc, "div", { "data-myq": "caret" });
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

    /* ------------------------------------------------------------------ *
     * 提示条
     * ------------------------------------------------------------------ */
    let toastTimer = null;
    function toast(text) {
      if (typeof document === "undefined") return;
      let node = document.getElementById(TOAST_ID);
      if (node === null) {
        node = el(document, "div", { id: TOAST_ID, "data-myq": "toast", role: "status" });
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
     * 划词浮动条（document 级单例）
     * ------------------------------------------------------------------ */
    const state = {
      bar: null,
      mode: null,
      found: null,
      settle: null,
      suppress: false,
      pointerOnTranscript: false
    };
    let listenersAttached = false;

    function readSelection() {
      const selection = typeof document.getSelection === "function" ? document.getSelection() : null;
      if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
      const range = selection.getRangeAt(0);
      // 输入框卡片里的划词是在改草稿，不是引用。
      if (closestFrom(range.startContainer, CARD_SELECTOR) !== null) return null;
      if (closestFrom(range.endContainer, CARD_SELECTOR) !== null) return null;
      // 只认领对话区里的划词；插件自己的浮层里的不算。
      if (closestFrom(range.startContainer, "[data-myq]") !== null) return null;
      const chat = closestFrom(range.startContainer, CONTENT_SELECTOR);
      if (chat === null) return null;
      const text = String(selection.toString()).replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
      if (text.trim().length === 0) return null;
      let sessionId = chat.getAttribute("data-conversation-session");
      if (typeof sessionId !== "string" || sessionId === "") {
        const active = document.querySelector(CONTENT_SELECTOR + "[data-conversation-session]");
        sessionId = active === null ? null : active.getAttribute("data-conversation-session");
      }
      if (typeof sessionId !== "string" || sessionId === "") return null;
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return null;
      return { text, x: rect.left + rect.width / 2, y: rect.top, bottom: rect.bottom, sessionId };
    }

    function ensureBar() {
      if (state.bar !== null && state.bar.isConnected) return state.bar;
      const bar = el(document, "div", { id: BAR_ID, "data-myq": "bar", role: "menu" });
      bar.addEventListener("click", onBarClick);
      (document.body ?? document.documentElement).append(bar);
      state.bar = bar;
      return bar;
    }
    function barRow(action, label) {
      return el(document, "button", { type: "button", class: "myq-row", "data-action": action, role: "menuitem" }, [
        el(document, "span", { class: "myq-label", text: label })
      ]);
    }
    function renderMenu(bar) {
      bar.replaceChildren(
        barRow("quote", translate("addToChat")),
        barRow("fork", translate("sideFork")),
        barRow("copy", translate("copy"))
      );
    }
    function positionBar(bar, found) {
      const box = bar.getBoundingClientRect();
      const left = clamp(found.x - box.width / 2, EDGE, window.innerWidth - box.width - EDGE);
      let top = found.y - box.height - GAP;
      if (top < EDGE) top = found.bottom + GAP;
      bar.style.left = Math.round(left) + "px";
      bar.style.top = Math.round(top) + "px";
    }
    function open(found) {
      state.found = found;
      const bar = ensureBar();
      renderMenu(bar);
      bar.style.visibility = "hidden";
      bar.style.display = "block";
      positionBar(bar, found);
      bar.style.visibility = "";
      state.mode = "menu";
    }
    function close() {
      if (state.bar !== null) state.bar.style.display = "none";
      state.mode = null;
      state.found = null;
      // 关掉它的那次手势不能立刻把它再打开；新的按下才算新意图。
      state.suppress = true;
    }
    function refresh() {
      if (state.suppress) return;
      const found = readSelection();
      if (found === null) {
        if (state.mode !== null) close();
        return;
      }
      open(found);
    }
    function clearPageSelection() {
      try {
        const selection = typeof document.getSelection === "function" ? document.getSelection() : null;
        if (selection !== null && typeof selection.removeAllRanges === "function") selection.removeAllRanges();
      } catch (error) {
        // 选区清不掉不影响结果。
      }
    }
    function writeClipboard(text) {
      try {
        if (typeof navigator === "undefined" || navigator.clipboard === undefined) return false;
        if (typeof navigator.clipboard.writeText !== "function") return false;
        navigator.clipboard.writeText(text);
        return true;
      } catch (error) {
        return false;
      }
    }
    function onBarClick(event) {
      const row = closestFrom(event.target, "[data-action]");
      if (row === null) return;
      event.preventDefault();
      event.stopPropagation();
      const action = row.getAttribute("data-action");
      if (action === "quote") commitQuote();
      else if (action === "fork") commitFork();
      else if (action === "copy") commitCopy();
    }
    function commitQuote() {
      const found = state.found;
      if (found === null) return;
      close();
      const ok = insertChip(found.sessionId, found.text);
      clearPageSelection();
      if (!ok) toast(translateFor(found.sessionId, "failed"));
    }
    function commitFork() {
      const found = state.found;
      if (found === null) return;
      close();
      clearPageSelection();
      forkQuote(found.sessionId, found.text);
    }
    function commitCopy() {
      const found = state.found;
      if (found === null) return;
      close();
      writeClipboard(found.text);
      toast(translateFor(found.sessionId, "copied"));
    }

    function onSelectionChange() {
      if (insideBar(document.activeElement)) return;
      if (state.settle !== null) clearTimeout(state.settle);
      state.settle = setTimeout(() => {
        state.settle = null;
        if (state.suppress) return;
        refresh();
      }, SETTLE_MS);
    }
    function onKeyUp(event) {
      if (event.key === "Escape") return;
      if (insideBar(event.target)) return;
      state.suppress = false;
      refresh();
    }
    function onPointerDown(event) {
      if (insideBar(event.target)) return;
      state.pointerOnTranscript = closestFrom(event.target, CONTENT_SELECTOR) !== null;
      state.suppress = false;
    }
    function onPointerUp(event) {
      if (!state.pointerOnTranscript) return;
      state.pointerOnTranscript = false;
      if (insideBar(event.target)) return;
      state.suppress = false;
      refresh();
    }
    function onMouseDown(event) {
      if (insideBar(event.target)) return;
      // 双击在已选范围里继续扩词时不动浮动条。
      const selection = typeof document.getSelection === "function" ? document.getSelection() : null;
      if (event.button === 0 && event.detail > 1 && selection !== null && selection.rangeCount === 1 && !selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        const element = elementOf(event.target);
        if (element !== null && range.intersectsNode(element)) return;
      }
      if (state.mode !== null) close();
    }
    function onKeyDown(event) {
      if (event.key === "Escape" && event.isComposing !== true && drag !== null) {
        cancelDrag();
        return;
      }
      if (event.key !== "Escape" || event.isComposing === true) return;
      if (insideBar(event.target)) return;
      if (state.mode !== null) close();
      hidePopover();
    }
    function onScrollOrResize() {
      hidePopover();
      if (state.mode !== null) close();
    }
    function insideBar(node) {
      const bar = state.bar;
      if (bar === null) return false;
      const element = elementOf(node);
      return element !== null && bar.contains(element);
    }
    function attachListeners() {
      if (listenersAttached) return;
      if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
      listenersAttached = true;
      document.addEventListener("selectionchange", onSelectionChange);
      document.addEventListener("keyup", onKeyUp, true);
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("pointerup", onPointerUp, true);
      document.addEventListener("pointercancel", onPointerUp, true);
      document.addEventListener("mousedown", onMouseDown, true);
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
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keyup", onKeyUp, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerUp, true);
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", onScrollOrResize, true);
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("resize", onScrollOrResize);
      }
      if (state.settle !== null) {
        clearTimeout(state.settle);
        state.settle = null;
      }
      if (state.bar !== null) {
        state.bar.remove();
        state.bar = null;
      }
      state.mode = null;
      state.found = null;
      const toastNode = document.getElementById(TOAST_ID);
      if (toastNode !== null) toastNode.remove();
    }

    /* ------------------------------------------------------------------ *
     * 引用分叉（主会话区打开）与分叉记录
     * ------------------------------------------------------------------ */
    function readForkMap() {
      try {
        const parsed = JSON.parse(localStorage.getItem(FORK_KEY));
        return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch (error) {
        return {};
      }
    }
    function writeForkMap(map) {
      try {
        localStorage.setItem(FORK_KEY, JSON.stringify(map));
      } catch (error) {
        // 记录丢失不影响分叉本身。
      }
    }
    function forksOf(sessionId) {
      const list = readForkMap()[sessionId];
      return Array.isArray(list) ? list : [];
    }
    function forkTitle(text) {
      const line = firstLineOf(text);
      const base = line === "" ? "…" : clip(line, 24);
      return translateFor(null, "forkPrefix") + base;
    }
    function rememberFork(sessionId, threadId, text) {
      const map = readForkMap();
      const list = Array.isArray(map[sessionId]) ? map[sessionId] : [];
      list.unshift({ threadId, title: forkTitle(text), excerpt: clip(flat(text), 60), at: Date.now(), archived: false });
      map[sessionId] = list.slice(0, FORK_LIMIT);
      writeForkMap(map);
    }
    function markForkArchived(sessionId, threadId) {
      const map = readForkMap();
      const list = map[sessionId];
      if (!Array.isArray(list)) return;
      for (const row of list) {
        if (row !== null && row !== undefined && row.threadId === threadId) row.archived = true;
      }
      writeForkMap(map);
    }
    /**
     * 打开分叉：DSH 右侧栏的 subagentchat 页签只接受 origin==="subagent" 的委派
     * 子会话（普通 fork 会被 subagent/unauthorized 拒绝），所以分叉在主会话区打开。
     */
    function openForkMain(threadId) {
      const workspace = serviceOf("uiWorkspace");
      if (workspace === null || workspace === undefined || typeof workspace.openSession !== "function") return false;
      try {
        workspace.openSession(threadId);
        return true;
      } catch (error) {
        console.warn("[my-quote] open fork failed:", error);
        return false;
      }
    }
    /** 顺手亮出右侧栏的管理页签，让用户能发现分叉记录。失败不影响主流程。 */
    function revealManagerTab() {
      const found = tabService();
      if (found === null) return;
      for (const key of [TAB_KIND, TAB_ID]) {
        try {
          found.right.openTab(key);
          return;
        } catch (error) {
          // 试下一个键形。
        }
      }
    }
    function shellDraft(shell) {
      const hosts = [shell, shell === null || shell === undefined ? null : shell.actions];
      for (const host of hosts) {
        if (host === null || host === undefined) continue;
        for (const name of ["getDraft", "readDraft"]) {
          try {
            const fn = host[name];
            if (typeof fn !== "function") continue;
            const value = fn.call(host);
            if (typeof value === "string") return value;
          } catch (error) {
            // 试下一个形态。
          }
        }
      }
      return null;
    }
    function writeDraft(shell, text) {
      try {
        if (typeof shell.setDraft === "function") {
          shell.setDraft(text);
          return true;
        }
        const actions = shell.actions;
        if (actions !== null && actions !== undefined && typeof actions.setDraft === "function") {
          actions.setDraft(text);
          return true;
        }
      } catch (error) {
        console.warn("[my-quote] fork draft refused:", error);
      }
      return false;
    }
    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /** 分叉页签刚打开时它的输入框还没挂载，轮询等它出现；已有草稿保留，引用接在后面。 */
    async function prefillDraft(sessionId, text) {
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const shell = inputShellFor(sessionId);
        if (shell !== null && shell !== undefined) {
          const current = shellDraft(shell);
          const kept = current === null ? "" : current.replace(/\s+$/u, "");
          const next = kept === "" ? text : kept + "\n\n" + text;
          return writeDraft(shell, next);
        }
        await sleep(200);
      }
      return false;
    }
    async function forkQuote(sessionId, text) {
      const sessions = serviceOf("sessions");
      if (sessions === null || sessions === undefined || typeof sessions.fork !== "function") {
        toast(translateFor(sessionId, "forkFailed"));
        return;
      }
      let threadId = null;
      try {
        threadId = await sessions.fork({ sessionId, increaseTitle: true });
      } catch (error) {
        console.warn("[my-quote] fork failed:", error);
        toast(translateFor(sessionId, "forkFailed"));
        return;
      }
      if (typeof threadId !== "string" || threadId === "") {
        toast(translateFor(sessionId, "forkFailed"));
        return;
      }
      const title = forkTitle(text);
      if (typeof sessions.rename === "function") {
        try {
          await sessions.rename(threadId, title);
        } catch (error) {
          // 标题保留子会话 id 也能用。
        }
      }
      rememberFork(sessionId, threadId, text);
      if (!openForkMain(threadId)) {
        toast(translateFor(sessionId, "forkFailed"));
        return;
      }
      revealManagerTab();
      if (!(await prefillDraft(threadId, quoteMarkdown(text)))) {
        toast(translateFor(sessionId, "forkDraftFailed"));
      }
    }
    function archiveFork(sessionId, threadId) {
      const workspace = serviceOf("uiWorkspace");
      if (workspace !== null && workspace !== undefined && typeof workspace.archiveSession === "function") {
        try {
          workspace.archiveSession(threadId);
        } catch (error) {
          console.warn("[my-quote] archive fork failed:", error);
        }
      }
      markForkArchived(sessionId, threadId);
    }

    /* ------------------------------------------------------------------ *
     * 管理页（右侧栏「引用分叉」页签）
     * ------------------------------------------------------------------ */
    function tabService() {
      if (pluginCtx === null || pluginCtx === undefined) return null;
      const read = (name) => {
        try {
          const value = typeof pluginCtx.get === "function" ? pluginCtx.get(name) : null;
          return value === undefined ? null : value;
        } catch (error) {
          return null;
        }
      };
      const tabs = read("sidebarRightTabs");
      const right = read("sidebarRight");
      if (tabs === null || typeof tabs.register !== "function") return null;
      if (right === null || typeof right.openTab !== "function") return null;
      return { tabs, right };
    }

    function ForkListBody(props) {
      const sessionId = typeof props.sessionId === "string" && props.sessionId !== "" ? props.sessionId : null;
      const [rows, setRows] = react.useState(() => (sessionId === null ? [] : forksOf(sessionId)));
      react.useEffect(() => {
        setRows(sessionId === null ? [] : forksOf(sessionId));
      }, [sessionId]);
      const t = (key) => translateFor(sessionId, key);
      const openRow = (threadId) => {
        if (typeof props.open === "function") props.open(threadId);
      };
      const archiveRow = (threadId) => {
        if (typeof props.archive === "function") props.archive(threadId);
        setRows(sessionId === null ? [] : forksOf(sessionId));
      };
      const body = [];
      if (rows.length === 0) {
        body.push(h("div", { key: "empty", className: "myq-list-note" }, t("managerEmpty")));
      }
      for (const row of rows) {
        if (row === null || row === undefined || typeof row.threadId !== "string") continue;
        body.push(
          h(
            "div",
            { key: row.threadId, className: "myq-fork", "data-archived": row.archived === true ? "true" : "false" },
            h("div", { className: "myq-fork-title", title: row.title }, row.title),
            h("div", { className: "myq-fork-excerpt" }, row.excerpt),
            h(
              "div",
              { className: "myq-fork-foot" },
              h("span", { className: "myq-fork-time" }, formatTime(row.at)),
              row.archived === true ? h("span", { className: "myq-fork-archived" }, t("managerArchived")) : null,
              h("button", { type: "button", className: "myq-btn", onClick: () => openRow(row.threadId) }, t("managerOpen")),
              row.archived === true
                ? null
                : h("button", { type: "button", className: "myq-btn", onClick: () => archiveRow(row.threadId) }, t("managerArchive"))
            )
          )
        );
      }
      return h(
        "div",
        { className: "myq-list" },
        h("div", { className: "myq-list-head" }, h("span", { className: "myq-list-count" }, t("managerCount").replace("{n}", String(rows.length)))),
        h("div", { className: "myq-list-body" }, body)
      );
    }

    /* ------------------------------------------------------------------ *
     * 样式安装
     * ------------------------------------------------------------------ */
    function installStyle() {
      if (typeof document === "undefined") return;
      if (document.getElementById(STYLE_ID) !== null) return;
      const style = el(document, "style", { id: STYLE_ID, "data-myq": "style" });
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
     * 不渲染任何可见内容，只为每个会话留下 inputActions 与 t()。
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
        return () => {
          if (bridges.get(sessionId) === entry) bridges.delete(sessionId);
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
      loadPersistedChips();
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "my-quote: dictionaries");
      ctx.effect(() => {
        holdSource();
        return releaseSource;
      }, "my-quote: reference source");
      ctx.effect(() => {
        holdRuntime();
        return releaseRuntime;
      }, "my-quote: runtime");
      // 管理页：右侧栏页签服务可能来得比本插件晚，放进 inject 里等服务就绪。
      const installManagerTab = (hostCtx) =>
        hostCtx.effect(() => {
          const found = tabService();
          if (found === null) return () => {};
          const disposers = [];
          try {
            disposers.push(
              found.tabs.register({
                id: TAB_ID,
                kind: TAB_KIND,
                title: () => translateFor(null, "managerTitle"),
                guide: [
                  {
                    id: "forks",
                    commandId: "my-quote.forks",
                    order: 20,
                    title: () => translateFor(null, "managerTitle"),
                    description: () => translateFor(null, "managerGuide")
                  }
                ]
              })
            );
          } catch (error) {
            // kind 被别的注册占用是对方的事。
          }
          disposers.push(
            ctx.slots.inject("sidebar.right.pane.tab", () =>
              ctx.slots.register(
                {
                  name: "sidebar.right.pane.tab",
                  key: TAB_ID,
                  locale: NS,
                  inject: (sessionId) => ({
                    sessionId,
                    open: (threadId) => openForkMain(threadId),
                    archive: (threadId) => archiveFork(sessionId, threadId)
                  })
                },
                ForkListBody
              )
            )
          );
          disposers.push(
            ctx.slots.inject("sidebar.right.pane.tab.title", () =>
              ctx.slots.register({ name: "sidebar.right.pane.tab.title", key: TAB_ID }, () =>
                h("span", null, translateFor(null, "managerTitle"))
              )
            )
          );
          return () => {
            for (const dispose of disposers.reverse()) {
              try {
                dispose();
              } catch (error) {
                // 卸载尽力而为。
              }
            }
          };
        }, "my-quote: fork tab");
      if (typeof ctx.inject === "function") {
        ctx.inject(["sidebarRightTabs", "sidebarRight"], (tabCtx) => {
          installManagerTab(tabCtx);
        });
      } else {
        installManagerTab(ctx);
      }
      ctx.slots.inject("conversation.input.overlay", () =>
        ctx.slots.register(
          {
            name: "conversation.input.overlay",
            id: "my-quote.bridge",
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
