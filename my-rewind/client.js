/**
 * MY-Rewind 对话回退 — Client 半边（v1：仅对话回退；文件快照还原在 v2）。
 *
 * 架构（两份独立源码规格书交叉核实，见 docs/dsh-rewind-plugin-*.md）：
 *   - 本插件对会话日志【零写入】：一切执行走 face.command("/rewind-plugin …")，
 *     由 host 半边追加 surfaceOp replace 标记事件；结果从 chat 视图里新出现
 *     的同名命令节点的 outcome 取回（knownCommandSeqs 防拿到陈旧节点）。
 *   - 隐藏已回退区间 = 扫 chat 快照里的命令节点（名字须继续识别
 *     "rewind-plugin"/"rewind"/"undo"，否则旧会话的隐藏状态会全部显形），
 *     按 [targetSeq … markerSeq] 把对应座席 display:none；卸载时恢复。
 *     ★ 相对原插件的修复：args 没有 @seq 时（裸 /rewind、/undo）从
 *     outcome.text 的 "seq N" 兜底解析目标——原版这种情况下刷新后隐藏全丢。
 *   - 消息上的「回退」按钮 = portal 进原生消息操作区（actionsContainerOf：
 *     行内最后一个非本插件按钮的父容器）；排队消息的「撤回」走 updateQueue。
 *   - popover 修复了原插件的透明背景 bug：--dsw-specific-menu 本身半透明，
 *     必须搭配 backdrop-filter: var(--dsw-menu-backdrop-filter)。
 */
window.__ModuleLoader__.load({
  id: "my-rewind",
  factory(require) {
    const react = require("react");
    const { createPortal } = require("react-dom");
    const h = react.createElement;

    /* ------------------------------------------------------------------ *
     * 文案
     * ------------------------------------------------------------------ */
    const NS = "my-rewind";
    const zh = {
      "action.rewind": "回退",
      "action.rewindTitle": "回退到这条消息（撤回它及之后的内容）",
      "action.retract": "撤回",
      "action.retractTitle": "撤回这条排队消息",
      "popover.title": "回退到这条消息",
      "popover.retractTitle": "撤回排队消息",
      "popover.note": "将撤回这条消息及之后的全部内容，消息文本放回输入框；历史仍完整保留，只是对模型隐藏。",
      "popover.retractNote": "将撤回这条及其后的排队消息，文本放回输入框。",
      "popover.confirm": "回退",
      "popover.retractConfirm": "撤回",
      "popover.cancel": "取消",
      "popover.noText": "（无文本）",
      "toast.success": "已回退",
      "toast.failed": "回退失败，请重试",
      "toast.timeout": "回退超时，请查看会话状态",
      "toast.retracted": "已撤回排队消息",
      "toast.retractFailed": "撤回失败，请重试"
    };
    const en = {
      "action.rewind": "Rewind",
      "action.rewindTitle": "Rewind to this message (withdraw it and everything after)",
      "action.retract": "Retract",
      "action.retractTitle": "Retract this queued message",
      "popover.title": "Rewind to this message",
      "popover.retractTitle": "Retract queued message",
      "popover.note": "Withdraws this message and everything after it, and puts the text back into the input box. History stays on disk — only hidden from the model.",
      "popover.retractNote": "Retracts this and any later queued messages; the text returns to the input box.",
      "popover.confirm": "Rewind",
      "popover.retractConfirm": "Retract",
      "popover.cancel": "Cancel",
      "popover.noText": "(no text)",
      "toast.success": "Rewound",
      "toast.failed": "Rewind failed, please try again",
      "toast.timeout": "Rewind timed out — check the session state",
      "toast.retracted": "Queued message retracted",
      "toast.retractFailed": "Retract failed, please try again"
    };

    /* ------------------------------------------------------------------ *
     * 常量
     * ------------------------------------------------------------------ */
    const ENGINE_COMMAND = "rewind-plugin";
    // 必须与原插件一致：隐藏状态靠识别这些命令名重建
    const ENGINE_COMMAND_NAMES = new Set(["rewind-plugin", "rewind", "undo"]);
    const HEADER_ACTIONS_SLOT = "conversation.session.header.actions";
    const USER_SEAT_SELECTOR = '[data-chat-flow-kind="user"][data-chat-anchor-key], [data-chat-flow-kind="steering"][data-chat-anchor-key]';
    const CHAT_SEAT_SELECTOR = "[data-chat-anchor-key]";
    const GROUP_SHELL_SELECTOR = '[data-chat-anchor-key^="group:"]';
    const PENDING_SEAT_SELECTOR = "[data-pending-steering]";
    const MESSAGE_ATTACHMENT_SELECTOR = "[data-message-attachments]";
    const COMPOSER_EDITABLE_SELECTOR = "[data-composer-input]";
    // 这些区域里的 DOM 变化不触发 portal 重扫（输入框打字等高频更新）
    const IGNORED_PORTAL_SCOPE = [
      "[data-composer-seat]",
      "[data-composer-input]",
      "[data-sidebar-right-panel]",
      "[data-sidebar-chat]",
      "[data-plugin-panel]",
      ".my-rewind-popover",
      ".my-rewind-toast"
    ].join(",");
    const PREVIEW_CHARS = 80;
    const QUEUE_PREVIEW_CHARS = 200;
    const DEFAULT_CANDIDATE_LIMIT = 100;
    const CANDIDATE_LIST_HEADER = "candidates=";
    const EXEC_TIMEOUT_MS = 20000;
    const CANDIDATES_TIMEOUT_MS = 8000;

    /* ------------------------------------------------------------------ *
     * 样式（token 用法与原生菜单一致；backdrop-filter 是重叠 bug 的修复关键）
     * ------------------------------------------------------------------ */
    const STYLE_TEXT = `
.my-rewind-action {
  display: inline-flex; align-items: center; justify-content: center;
  border: none; background: transparent; cursor: pointer;
  font: inherit; white-space: nowrap;
}
.my-rewind-action-fallback {
  color: var(--dsw-alias-label-tertiary, #8a93a6);
  padding: 4px; border-radius: var(--dsw-alias-radius-sm, 4px);
}
.my-rewind-action-fallback:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,.06)); color: var(--dsw-alias-label-primary, #171e30); }
.my-rewind-action svg { display: block; }
.my-rewind-popover {
  position: fixed; z-index: 2147483002; width: 340px; max-width: calc(100vw - 16px);
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-3, #ffffff));
  backdrop-filter: var(--dsw-menu-backdrop-filter, blur(12px));
  -webkit-backdrop-filter: var(--dsw-menu-backdrop-filter, blur(12px));
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06));
  border-radius: var(--dsw-alias-radius-md, 8px);
  box-shadow: var(--dsw-alias-shadow-lv3, 0 8px 24px rgba(15,23,42,.18));
  padding: 12px; color: var(--dsw-alias-label-primary, #171e30);
  font-size: 13px; line-height: 20px;
}
.my-rewind-popover .my-rewind-title { font-weight: 600; margin-bottom: 6px; }
.my-rewind-popover .my-rewind-target { color: var(--dsw-alias-label-tertiary, #8a93a6); font-size: 12px; margin-bottom: 6px; }
.my-rewind-popover .my-rewind-preview {
  border-left: 2px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12));
  padding: 2px 8px; margin: 0 0 8px;
  color: var(--dsw-alias-label-secondary, #5a6478);
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
  white-space: pre-wrap; word-break: break-word;
}
.my-rewind-popover .my-rewind-note { color: var(--dsw-alias-label-tertiary, #8a6478); color: var(--dsw-alias-label-tertiary, #8a93a6); font-size: 12px; margin-bottom: 10px; }
.my-rewind-popover .my-rewind-buttons { display: flex; justify-content: flex-end; gap: 8px; }
.my-rewind-popover .my-rewind-btn {
  font: inherit; font-size: 12px; line-height: 18px; cursor: pointer;
  padding: 4px 12px; border-radius: var(--dsw-alias-radius-sm, 4px);
  border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
  background: transparent; color: var(--dsw-alias-label-primary, #171e30);
}
.my-rewind-popover .my-rewind-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,.06)); }
.my-rewind-popover .my-rewind-btn.primary {
  background: var(--dsw-alias-button-primary-fill, #171e30);
  color: var(--dsw-alias-label-primary-inverted, #ffffff);
  border-color: transparent;
}
.my-rewind-popover .my-rewind-btn.primary:hover { opacity: .88; background: var(--dsw-alias-button-primary-fill, #171e30); }
.my-rewind-toast {
  position: fixed; left: 50%; bottom: 96px; transform: translateX(-50%);
  z-index: 2147483003; max-width: min(520px, calc(100vw - 32px));
  background: var(--dsw-alias-toast-bg, #2a3244); color: var(--dsw-alias-toast-label, #ffffff);
  font-size: 13px; line-height: 20px; padding: 8px 14px;
  border-radius: var(--dsw-alias-radius-md, 8px);
  box-shadow: var(--dsw-alias-shadow-lv3, 0 8px 24px rgba(15,23,42,.18));
  pointer-events: none;
}
`;

    /* ------------------------------------------------------------------ *
     * 通用小工具
     * ------------------------------------------------------------------ */
    function el(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    let toastEl = null;
    let toastTimer = 0;
    function showToast(text) {
      if (!text) return;
      if (toastEl === null) {
        toastEl = el("div", "my-rewind-toast");
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = text;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toastEl?.remove();
        toastEl = null;
      }, 4000);
    }
    function removeToast() {
      clearTimeout(toastTimer);
      toastEl?.remove();
      toastEl = null;
    }

    /* ------------------------------------------------------------------ *
     * chat 快照读取（uiConversation.binding(sessionId).target("chat")）
     * node = {key, kind:"user"|"steering"|"command"|"turn-process", anchorSeq, data}
     * user/steering data = {seq,time,content}; command data = {seq,name,args,outcome?}
     * ------------------------------------------------------------------ */
    function chatSnapshotOf(view) {
      // view 是 uiConversation 的 chat 视图对象；快照必须 view.getSnapshot() 取，
      // 且按原插件做法原样透传（不做字段归一化——nodes 若非 Map 实例会被静默清空）。
      if (view === null || view === undefined || typeof view.getSnapshot !== "function") return undefined;
      try {
        return view.getSnapshot() ?? undefined;
      } catch {
        return undefined;
      }
    }
    function textOf(content) {
      if (!Array.isArray(content)) return null;
      const texts = content.filter((block) => block?.type === "text");
      if (texts.length === 0) return null;
      return texts.map((block) => (typeof block.text === "string" ? block.text : "")).join("");
    }
    function nodeBySeq(chat, seq) {
      for (const node of chat.nodes.values()) {
        if ((node.kind === "user" || node.kind === "steering") && node.data?.seq === seq) return node;
      }
      return undefined;
    }
    function messageTextAt(chat, seq) {
      const node = nodeBySeq(chat, seq);
      return node === undefined ? null : textOf(node.data?.content);
    }
    function messageAttachmentsAt(chat, seq) {
      const node = nodeBySeq(chat, seq);
      const content = node?.data?.content;
      if (!Array.isArray(content)) return [];
      const images = [];
      for (const block of content) {
        if (block?.type !== "image") continue;
        const ref = block.attachment ?? block;
        if (typeof ref?.attachmentId !== "string" || typeof ref?.mediaType !== "string") continue;
        images.push({ attachmentId: ref.attachmentId, mediaType: ref.mediaType, name: typeof ref.name === "string" ? ref.name : undefined });
      }
      return images;
    }
    function messagePreviewOf(content) {
      const text = (textOf(content) ?? "").replace(/\s+/g, " ").trim();
      return text.length <= PREVIEW_CHARS ? text : `${text.slice(0, PREVIEW_CHARS - 1)}…`;
    }
    function formatCandidateTime(time) {
      const d = new Date(time);
      if (Number.isNaN(d.getTime())) return "";
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    }

    /* ------------------------------------------------------------------ *
     * 隐藏区间重建（兼容旧会话：命令名集合含 rewind-plugin/rewind/undo；
     * args 无 @seq 时从 outcome.text 的 "seq N" 兜底——修复原版裸 /rewind
     * 刷新后隐藏状态丢失的缺陷）
     * ------------------------------------------------------------------ */
    function coalesceCuts(spans) {
      const sorted = spans.filter((s) => Number.isSafeInteger(s.start) && Number.isSafeInteger(s.end)).sort((a, b) => a.start - b.start);
      const cuts = [];
      for (const span of sorted) {
        const last = cuts[cuts.length - 1];
        if (last !== undefined && span.start <= last.end + 1) last.end = Math.max(last.end, span.end);
        else cuts.push({ start: span.start, end: span.end });
      }
      return cuts;
    }
    function cutsContain(cuts, seq) {
      for (const cut of cuts) if (seq >= cut.start && seq <= cut.end) return true;
      return false;
    }
    const hiddenSeqMemo = new WeakMap();
    function hiddenSeqsOf(chat) {
      const cached = hiddenSeqMemo.get(chat);
      if (cached !== undefined) return cached;
      const spans = [];
      const singles = new Set();
      for (const key of chat.order) {
        const node = chat.nodes.get(key);
        if (node === undefined || node.kind !== "command") continue;
        const data = node.data ?? {};
        if (!ENGINE_COMMAND_NAMES.has(data.name)) continue;
        if (typeof data.seq === "number") singles.add(data.seq);
        if (typeof node.anchorSeq === "number") singles.add(node.anchorSeq);
        const args = typeof data.args === "string" ? data.args : "";
        if (/\b(preview|__candidates)\b/.test(args)) continue;
        const outcome = data.outcome;
        if (outcome === null || outcome === undefined || outcome.kind !== "success") continue;
        if (typeof outcome.sourceEventSeq !== "number") continue;
        let start = NaN;
        const fromArgs = /@(\d+)/.exec(args);
        if (fromArgs !== null) start = Number(fromArgs[1]);
        if (!Number.isSafeInteger(start) && typeof outcome.text === "string") {
          // 裸 /rewind、/undo：成功文案里带 "seq N"（中英文案都含），兼容旧英文 "Withdrawn seq N"
          const fromText = /seq (\d+)/.exec(outcome.text);
          if (fromText !== null) start = Number(fromText[1]);
        }
        if (Number.isSafeInteger(start)) spans.push({ start, end: outcome.sourceEventSeq });
      }
      const cuts = coalesceCuts(spans);
      const hidden = new Set(singles);
      if (cuts.length > 0) {
        for (const key of chat.order) {
          const node = chat.nodes.get(key);
          if (node === undefined) continue;
          const anchor = typeof node.anchorSeq === "number" ? node.anchorSeq : node.data?.seq;
          if (typeof anchor === "number" && cutsContain(cuts, anchor)) {
            hidden.add(anchor);
            if (typeof node.data?.seq === "number") hidden.add(node.data.seq);
          }
        }
      }
      hiddenSeqMemo.set(chat, hidden);
      return hidden;
    }

    /* ------------------------------------------------------------------ *
     * 座席（DOM）操作
     * ------------------------------------------------------------------ */
    function resolveSeatAnchorSeq(seat, chat) {
      if (!(seat instanceof Element)) return undefined;
      const key = seat.dataset.chatAnchorKey ?? seat.dataset.chatNodeKey;
      if (typeof key !== "string" || key === "") return undefined;
      const node = chat.nodes.get(key);
      if (node === undefined) return undefined;
      return typeof node.anchorSeq === "number" ? node.anchorSeq : node.data?.seq;
    }
    function hideWithdrawnSeats(chat, hiddenSeqs, hiddenMap) {
      const seats = document.querySelectorAll(CHAT_SEAT_SELECTOR);
      for (const seat of seats) {
        if (hiddenMap.has(seat)) continue;
        const anchorSeq = resolveSeatAnchorSeq(seat, chat);
        if (typeof anchorSeq !== "number" || !hiddenSeqs.has(anchorSeq)) continue;
        hiddenMap.set(seat, seat.style.display);
        seat.style.display = "none";
        seat.dataset.myRewindHidden = "1";
      }
      // 组壳：子座席全隐时壳也隐
      for (const shell of document.querySelectorAll(GROUP_SHELL_SELECTOR)) {
        if (hiddenMap.has(shell)) continue;
        const kids = shell.querySelectorAll(CHAT_SEAT_SELECTOR);
        if (kids.length === 0) continue;
        let allHidden = true;
        for (const kid of kids) {
          if (kid.style.display !== "none") { allHidden = false; break; }
        }
        if (!allHidden) continue;
        hiddenMap.set(shell, shell.style.display);
        shell.style.display = "none";
        shell.dataset.myRewindHidden = "1";
      }
    }
    function showHiddenSeats(hiddenMap) {
      for (const [seat, display] of hiddenMap) {
        seat.style.display = display;
        delete seat.dataset.myRewindHidden;
      }
      hiddenMap.clear();
    }
    function actionsContainerOf(row) {
      if (!(row instanceof Element)) return undefined;
      const buttons = row.querySelectorAll("button");
      for (let i = buttons.length - 1; i >= 0; i--) {
        const button = buttons[i];
        if (button.classList.contains("my-rewind-action")) continue;
        if (button.parentElement instanceof HTMLElement) return button.parentElement;
      }
      return undefined;
    }
    // 抄同容器里原生动作按钮（复制等）的 className，让按钮外观与原生完全一致
    function nativeButtonClass(container) {
      if (!(container instanceof Element)) return undefined;
      const btn = container.querySelector("button:not(.my-rewind-action)");
      const cls = typeof btn?.className === "string" ? btn.className.trim() : "";
      return cls === "" ? undefined : cls;
    }

    /* ------------------------------------------------------------------ *
     * 目标收集
     * ------------------------------------------------------------------ */
    function collectTargets(chat, hiddenSeqs) {
      // 与原插件一致：先扫座席建 key→row 映射（避开 querySelector 属性选择器的
      // 转义问题，node key 里可能含冒号等字符）
      const rows = new Map();
      for (const element of document.querySelectorAll(USER_SEAT_SELECTOR)) {
        const key = element.dataset?.chatAnchorKey;
        if (typeof key === "string" && key !== "") rows.set(key, element);
      }
      const targets = [];
      for (const key of chat.order) {
        const node = chat.nodes.get(key);
        if (node === undefined || (node.kind !== "user" && node.kind !== "steering")) continue;
        const seq = node.data?.seq;
        if (typeof seq !== "number") continue;
        const anchor = typeof node.anchorSeq === "number" ? node.anchorSeq : seq;
        if (hiddenSeqs.has(anchor) || hiddenSeqs.has(seq)) continue;
        const row = rows.get(key);
        if (row === undefined) continue;
        const container = actionsContainerOf(row);
        if (container === undefined) continue;
        targets.push({ type: "rewind", key, seq, container });
      }
      return targets;
    }
    function previewOf(text) {
      const chars = Array.from((text ?? "").replace(/\s+/g, " ").trim());
      return chars.length > QUEUE_PREVIEW_CHARS ? `${chars.slice(0, QUEUE_PREVIEW_CHARS).join("")}…` : chars.join("");
    }
    function steeringItemsOf(nextStep) {
      return (nextStep ?? [])
        .filter((item) => item?.source?.kind === "user")
        .map((item) => {
          const text = textOf(item.content);
          const attachments = Array.isArray(item.content) ? item.content.filter((block) => block?.type !== "text").length : 0;
          return { id: item.id, text, attachments, preview: previewOf(text) };
        });
    }
    function bubbleTextOf(row) {
      const clone = row.cloneNode(true);
      clone.querySelectorAll(`${MESSAGE_ATTACHMENT_SELECTOR}, button`).forEach((node) => node.remove());
      return clone.textContent?.trim() ?? "";
    }
    function collectPendingTargets(steering) {
      const rows = [...document.querySelectorAll(PENDING_SEAT_SELECTOR)];
      const targets = [];
      for (let i = 0; i < rows.length; i++) {
        const item = steering[i];
        if (item === undefined) continue;
        const row = rows[i];
        const attachments = row.querySelector(MESSAGE_ATTACHMENT_SELECTOR)?.children.length ?? 0;
        const matched = item.attachments > 0 ? attachments === item.attachments : bubbleTextOf(row) === (item.text ?? "").trim();
        if (!matched) continue;
        const container = actionsContainerOf(row);
        if (container === undefined) continue;
        targets.push({ type: "retract", key: `pending-${item.id}`, itemId: item.id, text: item.text, preview: item.preview, container });
      }
      return targets;
    }
    function sameTargets(left, right) {
      if (left.length !== right.length) return false;
      for (let i = 0; i < left.length; i++) {
        const a = left[i];
        const b = right[i];
        if (a.type !== b.type || a.key !== b.key || a.container !== b.container) return false;
      }
      return true;
    }

    /* ------------------------------------------------------------------ *
     * 命令取回（host 的结果写进 chat 视图里的命令节点 outcome）
     * ------------------------------------------------------------------ */
    function isRewindCommandNode(node) {
      return node?.kind === "command" && ENGINE_COMMAND_NAMES.has(node.data?.name);
    }
    function isExecutedRewindFor(node, seq) {
      if (!isRewindCommandNode(node)) return false;
      const args = typeof node.data?.args === "string" ? node.data.args : "";
      return new RegExp(`@${seq}(\\D|$)`).test(args);
    }
    function isCandidateCommand(node) {
      if (!isRewindCommandNode(node)) return false;
      return typeof node.data?.args === "string" && node.data.args.includes("__candidates");
    }
    function findLastCommand(chat, match) {
      for (let i = chat.order.length - 1; i >= 0; i--) {
        const node = chat.nodes.get(chat.order[i]);
        if (node !== undefined && match(node)) return node;
      }
      return undefined;
    }
    function knownCommandSeqs(face, chatOf, match) {
      const known = new Set();
      const chat = chatOf(face);
      if (chat !== undefined) {
        for (const key of chat.order) {
          const node = chat.nodes.get(key);
          if (node !== undefined && match(node) && typeof node.data?.seq === "number") known.add(node.data.seq);
        }
      }
      return known;
    }
    function waitForCommand(face, chatOf, match, timeoutMs, watch) {
      return new Promise((resolve) => {
        let settled = false;
        let unwatch = null;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try { unwatch?.(); } catch { /* noop */ }
          resolve(value);
        };
        const check = () => {
          const chat = chatOf(face);
          if (chat === undefined) return;
          const node = findLastCommand(chat, match);
          const outcome = node?.data?.outcome;
          if (outcome !== null && outcome !== undefined) finish(outcome);
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        unwatch = watch(() => queueMicrotask(check));
        check();
      });
    }
    function rewindCandidatesFromHostText(text) {
      if (typeof text !== "string" || !text.startsWith(CANDIDATE_LIST_HEADER)) return [];
      const candidates = [];
      for (const line of text.split("\n").slice(1)) {
        if (line === "") continue;
        const parts = line.split("\t");
        if (parts.length !== 3) continue;
        const seq = Number(parts[0]);
        const time = Number(parts[1]);
        if (!Number.isSafeInteger(seq) || !Number.isFinite(time)) continue;
        candidates.push({ seq, time, preview: parts[2] ?? "" });
      }
      return candidates;
    }

    /* ------------------------------------------------------------------ *
     * 执行与回填
     * ------------------------------------------------------------------ */
    function composerIsEmpty() {
      const editable = document.querySelector(COMPOSER_EDITABLE_SELECTOR);
      if (editable === null) return true;
      return (editable.textContent ?? "").trim() === "";
    }
    function fillComposerEditable(text) {
      const editable = document.querySelector(COMPOSER_EDITABLE_SELECTOR);
      if (editable === null) return false;
      editable.focus();
      const selection = document.getSelection();
      if (selection !== null) {
        const range = document.createRange();
        range.selectNodeContents(editable);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      let ok = false;
      try {
        ok = document.execCommand("insertText", false, text);
      } catch {
        ok = false;
      }
      if (ok) return true;
      editable.textContent = text;
      editable.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    async function runRewindAndFill(deps, face, seq, t) {
      const known = knownCommandSeqs(face, deps.chatOf, (node) => isExecutedRewindFor(node, seq));
      let result;
      try {
        result = await face.command(`/${ENGINE_COMMAND} @${seq} chat`);
      } catch {
        result = undefined;
      }
      if (result === undefined || result.ok !== true || result.value?.matched !== true) {
        showToast(t("toast.failed"));
        return;
      }
      const outcome = await waitForCommand(
        face,
        deps.chatOf,
        (node) => isExecutedRewindFor(node, seq) && !known.has(node.data?.seq),
        EXEC_TIMEOUT_MS,
        (cb) => deps.watchChat(face.sessionId, cb)
      );
      if (outcome === null) {
        showToast(t("toast.timeout"));
        return;
      }
      if (outcome.kind !== "success") {
        showToast(outcome.text ?? t("toast.failed"));
        return;
      }
      showToast(t("toast.success"));
      if (!deps.isMainViewSession(face.sessionId)) return;
      const chat = deps.chatOf(face);
      if (chat === undefined) return;
      const text = messageTextAt(chat, seq);
      const images = messageAttachmentsAt(chat, seq);
      await deps.restoreImages(face.sessionId, images);
      if (text !== null && text !== "" && composerIsEmpty()) {
        deps.setComposerText(face.sessionId, text);
      }
    }
    async function retractPending(deps, face, itemId, text, t) {
      const inbox = deps.inboxOf(face);
      const steering = steeringItemsOf(inbox?.getSnapshot?.()?.nextStep);
      const index = steering.findIndex((item) => item.id === itemId);
      if (index === -1) {
        showToast(t("toast.retractFailed"));
        return;
      }
      const span = steering.slice(index).map((item) => item.id);
      for (let i = span.length - 1; i >= 0; i--) {
        let res;
        try {
          res = await face.updateQueue(span[i], { kind: "remove" });
        } catch {
          res = undefined;
        }
        if (res?.ok !== true) {
          showToast(t("toast.retractFailed"));
          return;
        }
      }
      showToast(t("toast.retracted"));
      if (typeof text === "string" && text !== "" && composerIsEmpty()) {
        deps.setComposerText(face.sessionId, text);
      }
    }

    /* ------------------------------------------------------------------ *
     * 确认卡（单步 popover；修复原版透明背景 bug）
     * ------------------------------------------------------------------ */
    let popoverRoot = null;
    let popoverCleanup = null;
    function closePopover() {
      popoverCleanup?.();
      popoverCleanup = null;
      popoverRoot?.remove();
      popoverRoot = null;
    }
    function openConfirmCard(opts) {
      closePopover();
      const root = el("div", "my-rewind-popover");
      root.appendChild(el("div", "my-rewind-title", opts.title));
      if (opts.targetLine) root.appendChild(el("div", "my-rewind-target", opts.targetLine));
      if (opts.preview) root.appendChild(el("div", "my-rewind-preview", opts.preview));
      root.appendChild(el("div", "my-rewind-note", opts.note));
      const buttons = el("div", "my-rewind-buttons");
      const cancel = el("button", "my-rewind-btn", opts.cancelLabel);
      const confirm = el("button", "my-rewind-btn primary", opts.confirmLabel);
      buttons.appendChild(cancel);
      buttons.appendChild(confirm);
      root.appendChild(buttons);
      document.body.appendChild(root);
      popoverRoot = root;

      // 定位：锚下方 4px，放不下则上方；左右夹紧视口
      const anchorRect = opts.anchor?.getBoundingClientRect?.() ?? { left: 16, right: 16, top: 120, bottom: 120 };
      const rect = root.getBoundingClientRect();
      let top = anchorRect.bottom + 4;
      if (top + rect.height > window.innerHeight - 8) top = Math.max(8, anchorRect.top - rect.height - 4);
      const left = Math.max(8, Math.min(anchorRect.right - rect.width, window.innerWidth - 8 - rect.width));
      root.style.top = `${top}px`;
      root.style.left = `${left}px`;

      const onPointerDown = (event) => {
        if (root.contains(event.target)) return;
        closePopover();
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          closePopover();
        }
      };
      const timer = setTimeout(() => {
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown, true);
      }, 0);
      popoverCleanup = () => {
        clearTimeout(timer);
        document.removeEventListener("pointerdown", onPointerDown, true);
        document.removeEventListener("keydown", onKeyDown, true);
      };
      cancel.addEventListener("click", () => closePopover());
      confirm.addEventListener("click", () => {
        closePopover();
        opts.onConfirm();
      });
      confirm.focus();
    }
    function openRewindCard(deps, face, target, anchor, t) {
      const chat = deps.chatOf(face);
      const node = chat === undefined ? undefined : nodeBySeq(chat, target.seq);
      const time = node?.data?.time;
      const preview = node === undefined ? "" : messagePreviewOf(node.data?.content);
      openConfirmCard({
        anchor,
        title: t("popover.title"),
        targetLine: `seq ${target.seq}${typeof time === "number" ? ` · ${formatCandidateTime(time)}` : ""}`,
        preview: preview === "" ? t("popover.noText") : preview,
        note: t("popover.note"),
        confirmLabel: t("popover.confirm"),
        cancelLabel: t("popover.cancel"),
        onConfirm: () => void runRewindAndFill(deps, face, target.seq, t)
      });
    }
    function openRetractCard(deps, face, target, anchor, t) {
      openConfirmCard({
        anchor,
        title: t("popover.retractTitle"),
        preview: target.preview === "" ? t("popover.noText") : target.preview,
        note: t("popover.retractNote"),
        confirmLabel: t("popover.retractConfirm"),
        cancelLabel: t("popover.cancel"),
        onConfirm: () => void retractPending(deps, face, target.itemId, target.text, t)
      });
    }

    /* ------------------------------------------------------------------ *
     * 按钮与 Portal
     * ------------------------------------------------------------------ */
    function RewindIcon() {
      return h(
        "svg",
        { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
        h("path", { d: "M3 7h6a4 4 0 0 1 0 8H6" }),
        h("path", { d: "M5.5 4 2.5 7l3 3" })
      );
    }
    // 图标按钮与原生消息动作（复制等）对齐：抄同容器里原生按钮的 className，
    // 抄不到才用 my-rewind-action-fallback 的兜底色/悬停。
    function actionClassName(nativeClass) {
      return typeof nativeClass === "string" && nativeClass !== ""
        ? `${nativeClass} my-rewind-action`
        : "my-rewind-action my-rewind-action-fallback";
    }
    function RewindButton({ target, deps, face, t }) {
      return h(
        "button",
        {
          type: "button",
          className: actionClassName(target.nativeClass),
          title: t("action.rewindTitle"),
          onClick: (event) => {
            event.stopPropagation();
            openRewindCard(deps, face, target, event.currentTarget, t);
          }
        },
        h(RewindIcon)
      );
    }
    function RetractButton({ target, deps, face, t }) {
      return h(
        "button",
        {
          type: "button",
          className: actionClassName(target.nativeClass),
          title: t("action.retractTitle"),
          onClick: (event) => {
            event.stopPropagation();
            openRetractCard(deps, face, target, event.currentTarget, t);
          }
        },
        h(RewindIcon)
      );
    }

    function RewindPortals({ sessionId, deps, t }) {
      const [targets, setTargets] = react.useState([]);
      const targetsRef = react.useRef([]);
      const [, force] = react.useState(0);
      react.useEffect(() => deps.subscribeLocale(() => force((x) => x + 1)), [deps]);
      react.useLayoutEffect(() => {
        const hiddenMap = new Map();
        let disposed = false;
        const face = deps.sessionOf(sessionId);
        const refresh = () => {
          if (disposed) return;
          const liveFace = deps.sessionOf(sessionId);
          const snap = liveFace?.getSnapshot?.();
          if (snap?.subagent) {
            if (targetsRef.current.length !== 0) {
              targetsRef.current = [];
              setTargets([]);
            }
            return;
          }
          const chat = deps.chatOf(liveFace);
          if (chat === undefined) return;
          const hiddenSeqs = hiddenSeqsOf(chat);
          hideWithdrawnSeats(chat, hiddenSeqs, hiddenMap);
          const durable = collectTargets(chat, hiddenSeqs);
          const inbox = deps.inboxOf(liveFace);
          const steering = steeringItemsOf(inbox?.getSnapshot?.()?.nextStep);
          const pending = collectPendingTargets(steering);
          const next = [...durable, ...pending];
          if (!sameTargets(targetsRef.current, next)) {
            targetsRef.current = next;
            setTargets(next);
          }
        };
        const schedule = () => queueMicrotask(refresh);
        const unwatch = deps.watchChat(sessionId, schedule);
        let inboxUnsub;
        try {
          const inbox = deps.inboxOf(face);
          inboxUnsub = inbox?.subscribe?.(schedule);
        } catch {
          inboxUnsub = undefined;
        }
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            const targetNode = record.target;
            if (targetNode instanceof Element && targetNode.closest(IGNORED_PORTAL_SCOPE) !== null) continue;
            schedule();
            return;
          }
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
        refresh();
        return () => {
          disposed = true;
          observer.disconnect();
          try { unwatch?.(); } catch { /* noop */ }
          try { inboxUnsub?.(); } catch { /* noop */ }
          showHiddenSeats(hiddenMap);
        };
      }, [sessionId, deps]);
      const face = deps.sessionOf(sessionId);
      if (face === undefined) return null;
      return targets.map((target) => {
        const decorated = { ...target, nativeClass: nativeButtonClass(target.container) };
        return createPortal(
          target.type === "rewind"
            ? h(RewindButton, { target: decorated, deps, face, t })
            : h(RetractButton, { target: decorated, deps, face, t }),
          target.container,
          target.key
        );
      });
    }

    function Bridge(props) {
      const sessionId = props?.sessionId;
      const deps = Bridge.deps;
      const t = Bridge.t;
      if (typeof sessionId !== "string" || sessionId === "") return null;
      return h(RewindPortals, { sessionId, deps, t });
    }

    /* ------------------------------------------------------------------ *
     * apply
     * ------------------------------------------------------------------ */
    function apply(ctx) {
      ctx.effect(function* () {
        yield ctx.locale.register(NS, { zh, en });
        const t = ctx.locale.bind(NS);

        const style = document.createElement("style");
        style.dataset.plugin = "my-rewind";
        style.textContent = STYLE_TEXT;
        document.head.appendChild(style);

        const uiConversation = () => ctx.get("uiConversation");
        // sessions 服务：声明 inject 后 ctx.sessions 可用；ctx.get 兜底（两者都可能 undefined）
        const sessionsSvc = () => {
          try {
            const got = ctx.get("sessions");
            if (got !== undefined) return got;
          } catch { /* noop */ }
          try {
            return ctx.sessions;
          } catch { return undefined; }
        };
        const sessionOf = (sessionId) => {
          try {
            return sessionsSvc()?.binding?.(sessionId)?.session;
          } catch {
            return undefined;
          }
        };
        const chatOf = (face) => {
          if (face === undefined) return undefined;
          try {
            return chatSnapshotOf(uiConversation()?.binding(face.sessionId).target("chat"));
          } catch {
            return undefined;
          }
        };
        const watchChat = (sessionId, cb) => {
          try {
            const view = uiConversation()?.binding(sessionId).target("chat");
            if (view !== undefined && typeof view.subscribe === "function") return view.subscribe(cb);
          } catch { /* noop */ }
          return () => {};
        };
        const isMainViewSession = (sessionId) => {
          try {
            return (sessionsSvc()?.list?.getSnapshot?.().byId?.[sessionId]?.retainedBy?.mainView ?? 0) > 0;
          } catch {
            return false;
          }
        };
        const inboxOf = (face) => {
          try {
            return face?.projections?.faceOf?.("inbox");
          } catch {
            return undefined;
          }
        };
        const subscribeLocale = (cb) => {
          try {
            return ctx.locale.subscribe(cb);
          } catch {
            return () => {};
          }
        };
        const composerFacade = (sessionId) => {
          const conversation = ctx.get("conversation");
          const input = conversation?.input;
          const scope = sessionsSvc()?.scope?.(sessionId);
          if (input === undefined || scope === undefined) return undefined;
          return {
            setDraft: (draft) => input.for(scope).setDraft(draft),
            focus: () => input.for(scope).focus()
          };
        };
        const setComposerText = (sessionId, text) => {
          const facade = composerFacade(sessionId);
          if (facade !== undefined) {
            try {
              facade.setDraft(text);
              try { facade.focus(); } catch { /* noop */ }
              return true;
            } catch { /* fall through to DOM */ }
          }
          return fillComposerEditable(text);
        };
        const IMAGE_MEDIA_EXTENSION = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
        const restoreImages = async (sessionId, images) => {
          if (images.length === 0) return;
          const face = sessionOf(sessionId);
          const conversation = ctx.get("conversation");
          const scope = sessionsSvc()?.scope?.(sessionId);
          if (face === undefined || conversation?.input === undefined || conversation.createDrafts === undefined || scope === undefined) return;
          const files = [];
          for (const [index, ref] of images.entries()) {
            const extension = IMAGE_MEDIA_EXTENSION[ref.mediaType];
            if (extension === undefined) continue;
            try {
              const result = await face.readAttachment(ref.attachmentId);
              if (!result.ok) continue;
              files.push(new File([result.value.data], ref.name ?? `image-${index + 1}.${extension}`, { type: ref.mediaType }));
            } catch { /* skip broken attachment */ }
          }
          if (files.length === 0) return;
          try {
            const drafts = conversation.createDrafts(sessionId, files);
            const admitted = conversation.input.for(scope).addAttachments(drafts.map((draft) => draft.id));
            if (!admitted) conversation.releaseDraftAttachments?.(drafts);
          } catch { /* noop */ }
        };

        const deps = { sessionOf, chatOf, watchChat, isMainViewSession, inboxOf, subscribeLocale, setComposerText, restoreImages };
        Bridge.deps = deps;
        Bridge.t = t;

        yield ctx.slots.inject(HEADER_ACTIONS_SLOT, () =>
          ctx.slots.register(
            { name: HEADER_ACTIONS_SLOT, id: "my-rewind.portals", order: 1000, locale: NS, inject: () => ({}) },
            Bridge
          )
        );

        // /rewind、/undo 的斜杠命令选择器（host 候选列表）
        try {
          const commandUi = ctx.get("commandUi");
          if (commandUi !== undefined && typeof commandUi.decorate === "function") {
            const hostCandidatesCache = new Map();
            const hasCandidates = (session) => {
              const face = session?.sessionId === undefined ? undefined : sessionOf(session.sessionId);
              if (face === undefined) return false;
              try {
                if (face.getSnapshot?.()?.subagent) return false;
              } catch {
                return false;
              }
              const chat = chatOf(face);
              if (chat === undefined) return false;
              const hidden = hiddenSeqsOf(chat);
              for (const key of chat.order) {
                const node = chat.nodes.get(key);
                if (node === undefined || (node.kind !== "user" && node.kind !== "steering")) continue;
                const anchor = typeof node.anchorSeq === "number" ? node.anchorSeq : node.data?.seq;
                if (typeof anchor === "number" && !hidden.has(anchor)) return true;
              }
              return false;
            };
            const fetchHostCandidates = async (face) => {
              const known = knownCommandSeqs(face, chatOf, (node) => isCandidateCommand(node));
              const result = await face.command(`/${ENGINE_COMMAND} __candidates`);
              if (result.ok !== true || result.value?.matched !== true) return undefined;
              const outcome = await waitForCommand(
                face,
                chatOf,
                (node) => isCandidateCommand(node) && !known.has(node.data?.seq),
                CANDIDATES_TIMEOUT_MS,
                (cb) => watchChat(face.sessionId, cb)
              );
              if (outcome === null || outcome.kind !== "success") return undefined;
              return rewindCandidatesFromHostText(outcome.text);
            };
            const popupSpec = {
              available: (session) => hasCandidates(session),
              ui: {
                kind: "popupSelect",
                options: async (session) => {
                  const face = sessionOf(session.sessionId);
                  if (face === undefined) return [];
                  const candidates = await fetchHostCandidates(face);
                  if (candidates !== undefined) hostCandidatesCache.set(session.sessionId, candidates);
                  return (candidates ?? []).map((candidate) => ({
                    id: String(candidate.seq),
                    label: candidate.preview || t("popover.noText"),
                    detail: formatCandidateTime(candidate.time)
                  }));
                },
                onSelect: (option, session) => {
                  const face = sessionOf(session.sessionId);
                  if (face === undefined) return;
                  const candidate = hostCandidatesCache.get(session.sessionId)?.find((c) => c.seq === Number(option.id));
                  if (candidate === undefined) return;
                  const anchor = document.querySelector(COMPOSER_EDITABLE_SELECTOR)?.closest("[data-composer-card]") ?? document.body;
                  openConfirmCard({
                    anchor,
                    title: t("popover.title"),
                    targetLine: `seq ${candidate.seq} · ${formatCandidateTime(candidate.time)}`,
                    preview: candidate.preview === "" ? t("popover.noText") : candidate.preview,
                    note: t("popover.note"),
                    confirmLabel: t("popover.confirm"),
                    cancelLabel: t("popover.cancel"),
                    onConfirm: () => void runRewindAndFill(deps, face, candidate.seq, t)
                  });
                }
              }
            };
            for (const name of ["rewind", "undo"]) {
              yield commandUi.decorate({ name, ...popupSpec });
            }
          }
        } catch { /* 命令装饰失败不致命 */ }

        yield () => {
          closePopover();
          removeToast();
          style.remove();
        };
      }, "my-rewind client");
    }

    return { inject: ["slots", "sessions", "locale"], apply };
  }
});
