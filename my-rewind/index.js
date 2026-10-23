/**
 * MY-Rewind 对话回退 — Host 半边（v1：仅对话回退，文件快照还原在 v2）。
 *
 * 机制（两份独立源码规格书交叉核实，见 docs/dsh-rewind-plugin-*.md）：
 *   回退 = 往会话日志【追加】一条 user/message 标记事件（内容固定为
 *   "(empty message)"，source.kind = "my-rewind"），并携带
 *   surfaceOp {op:"replace", startSeq, endSeq} + sourceEventSeqs（必须覆盖
 *   每一个被遮蔽的 surface 节点，含目标消息自身，否则 append 抛错）。
 *   日志只增不改，天然可审计；与官方 /compact 同一套 surface fold 机制。
 *
 * 命令（名字与原 dsh-rewind-plugin 保持一致，以保住旧会话的隐藏状态重建
 * —— client 靠扫描 chat 视图里名为 "rewind-plugin"/"rewind" 的命令节点
 * 恢复隐藏区间，改名会让旧会话里已回退的内容全部显形）：
 *   /rewind、/undo            用户命令；空参 = 回退最近一条用户消息；
 *                             "@<seq>" 或倒数序号，模式可省略（默认 chat）。
 *   /rewind-plugin            client 机读通道："@<seq> chat" 执行 / "__candidates" 列表。
 *
 * 与原插件的取舍：不导入 @deepseek-ai/*（file: 链接安装无法解析宿主包），
 * marker 手工构造（{id:uuid, role:"user", content, source} 深冻结，与
 * createUserMessage 产物逐字段一致）；"both" 模式 v1 明确报错引导。
 */

const ENGINE_COMMAND = "rewind-plugin";
const MARKER_SOURCE = Object.freeze({ kind: "my-rewind" });
const MARKER_CONTENT = Object.freeze([Object.freeze({ type: "text", text: "(empty message)" })]);
const SEQ_TOKEN = /^@(\d+)$/;
const INDEX_TOKEN = /^(\d+)$/;
const CANDIDATE_PREVIEW_CHARS = 80;
const DEFAULT_CANDIDATE_LIMIT = 100;

/* ------------------------------------------------------------------ *
 * 文案（host 端内嵌字典；locale 每次调用重读，跟随设置切换）
 * ------------------------------------------------------------------ */
const en = {
  "command.description": "Rewind the conversation to a previous message",
  "command.undoDescription": "Alias of /rewind",
  "engine.description": "MY-Rewind internal command",
  "engine.inputHint": "@<seq> chat | __candidates",
  "engine.rejected": "Internal command: use /rewind or /undo.",
  "error.invalidTarget": 'Cannot parse target "{raw}" (expected <index> or @<seq>)',
  "error.invalidIndex": "Rewind index {index} has no candidate",
  "error.notFound": "No session event at seq {seq}",
  "error.notUser": "Session event at seq {seq} is not a human user message",
  "error.notOnSurface": "Message seq {seq} is no longer in the model context (shadowed by compaction)",
  "error.bothUnsupported": "File restore (mode \"both\") ships in MY-Rewind v2; nothing was changed. Use chat mode for now.",
  inflight: "A rewind is already running for this session; please wait.",
  stopFailed: "Could not stop the running agent; rewind cancelled. Please try again.",
  cancelled: "Rewind cancelled.",
  failed: "Rewind failed: {error}. The session is unchanged.",
  success: "Withdrawn seq {targetSeq} and everything after it (conversation returned to earlier).",
  noUserMessages: "This session has no rewindable user messages yet."
};
const zh = {
  "command.description": "回退对话到之前的某条消息",
  "command.undoDescription": "/rewind 的别名",
  "engine.description": "MY-Rewind 内部命令",
  "engine.inputHint": "@<seq> chat | __candidates",
  "engine.rejected": "内部命令：请使用 /rewind 或 /undo。",
  "error.invalidTarget": "无法解析目标「{raw}」（应为 <序号> 或 @<seq>）",
  "error.invalidIndex": "倒数序号 {index} 没有对应的消息",
  "error.notFound": "会话里没有 seq {seq} 这条事件",
  "error.notUser": "seq {seq} 不是一条用户消息",
  "error.notOnSurface": "seq {seq} 已不在模型上下文中（可能已被压缩遮蔽）",
  "error.bothUnsupported": "文件还原（both 模式）将在 MY-Rewind v2 提供；本次未做任何改动。当前请用 chat 模式。",
  inflight: "该会话已有一个回退正在执行，请稍候。",
  stopFailed: "无法停止运行中的 agent，回退已取消。请稍后再试。",
  cancelled: "回退已取消。",
  failed: "回退失败：{error}。会话未改变。",
  success: "已撤回 seq {targetSeq} 及之后内容（对话已回到此前）。",
  noUserMessages: "当前会话还没有可回退的用户消息。"
};
const DICTS = { en, zh };
let activeLocale = "en";
function t(key, params = {}) {
  const dict = DICTS[activeLocale] ?? en;
  let text = dict[key] ?? en[key] ?? key;
  for (const [name, value] of Object.entries(params)) {
    text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}
function readHostLocale(ctx) {
  try {
    const row = ctx.settings.describe({ redactSecrets: true }).find((entry) => entry.ns === "locale");
    const tag = row?.value?.preference;
    return typeof tag === "string" && tag.toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}
function withHostLocale(ctx, handler) {
  return (invocation) => {
    activeLocale = readHostLocale(ctx);
    return handler(invocation);
  };
}

/* ------------------------------------------------------------------ *
 * 目标解析与回退计划
 * ------------------------------------------------------------------ */
class RewindError extends Error {
  constructor(key, params) {
    super(t(key, params));
    this.name = "RewindError";
    this.key = key;
  }
}

function isHumanUserMessageEvent(event) {
  return event.type === "user/message" && event.data?.source?.kind === "user";
}

function messagePreview(message) {
  const text = (message.content ?? [])
    .map((block) => (block?.type === "text" && typeof block.text === "string" ? block.text : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= CANDIDATE_PREVIEW_CHARS ? text : `${text.slice(0, CANDIDATE_PREVIEW_CHARS - 1)}…`;
}

function parseRewindTarget(raw) {
  const token = raw.trim();
  const seq = SEQ_TOKEN.exec(token);
  if (seq !== null) {
    const value = Number(seq[1]);
    return Number.isSafeInteger(value) ? { kind: "seq", seq: value } : undefined;
  }
  const index = INDEX_TOKEN.exec(token);
  if (index !== null) {
    const value = Number(index[1] ?? "");
    return Number.isSafeInteger(value) && value >= 1 ? { kind: "index", index: value } : undefined;
  }
  return undefined;
}

function listRewindCandidates(events, surface, limit = DEFAULT_CANDIDATE_LIMIT) {
  const surfaceIndexes = new Map();
  for (let i = 0; i < surface.length; i++) surfaceIndexes.set(surface[i], i);
  const candidates = [];
  for (let i = events.length - 1; i >= 0 && candidates.length < limit; i--) {
    const event = events[i];
    if (!isHumanUserMessageEvent(event)) continue;
    if (!surfaceIndexes.has(event.seq)) continue;
    candidates.push({ seq: event.seq, time: event.time, preview: messagePreview(event.data), index: candidates.length + 1 });
  }
  return candidates;
}

function formatCandidateList(candidates) {
  // 机读契约（client 逐行解析）：首行 candidates=<n>，之后每行 <seq>\t<time>\t<preview>
  const lines = [`candidates=${candidates.length}`];
  for (const c of candidates) lines.push(`${c.seq}\t${c.time}\t${c.preview}`);
  return lines.join("\n");
}

function planRewind(events, surface, target) {
  let targetSeq;
  if (target.kind === "seq") {
    targetSeq = target.seq;
  } else {
    const candidate = listRewindCandidates(events, surface, target.index)[target.index - 1];
    if (candidate === undefined) throw new RewindError("error.invalidIndex", { index: target.index });
    targetSeq = candidate.seq;
  }
  const targetEvent = events.find((event) => event.seq === targetSeq);
  if (targetEvent === undefined) throw new RewindError("error.notFound", { seq: targetSeq });
  if (!isHumanUserMessageEvent(targetEvent)) throw new RewindError("error.notUser", { seq: targetSeq });
  const targetIndex = surface.indexOf(targetSeq);
  if (targetIndex === -1) throw new RewindError("error.notOnSurface", { seq: targetSeq });
  // 含目标消息自身：replace 区间 = [目标用户消息 … surface 末尾]
  const shadowedSeqs = surface.slice(targetIndex);
  return {
    targetSeq,
    shadowedSeqs,
    surfaceStart: shadowedSeqs[0],
    surfaceEnd: shadowedSeqs[shadowedSeqs.length - 1]
  };
}

function rewindErrorResult(error) {
  if (error instanceof RewindError) return { kind: "error", text: error.message };
  throw error;
}

/* ------------------------------------------------------------------ *
 * 执行
 * ------------------------------------------------------------------ */
function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

function buildMarker() {
  // 与 @deepseek-ai/dsh-llm 的 createUserMessage 产物逐字段一致（brand 是纯类型层）
  return deepFreeze({
    id: crypto.randomUUID(),
    role: "user",
    content: MARKER_CONTENT.map((block) => ({ ...block })),
    source: { ...MARKER_SOURCE }
  });
}

async function waitForAgentIdle(agent, signal, timeoutMs = 15000) {
  if (signal?.aborted) return false;
  let timer;
  let onAbort;
  try {
    await Promise.race([
      agent.whenIdle(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("rewind idle wait timed out")), timeoutMs);
        onAbort = () => reject(new Error("rewind idle wait aborted"));
        signal?.addEventListener("abort", onAbort, { once: true });
      })
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort);
  }
}

function dropPendingSteering(agent) {
  for (const message of [...(agent.inbox?.nextStep ?? [])]) {
    try {
      agent.inbox.remove(message.id);
    } catch {
      /* 排队项可能已被消费，忽略 */
    }
  }
}

async function executeRewind(invocation, rawTarget, inflight) {
  const { agent } = invocation;
  const sessionId = agent.session.id;
  if (inflight.has(sessionId)) return { kind: "error", text: t("inflight") };
  inflight.add(sessionId);
  try {
    if (agent.status !== "idle") {
      agent.cancel({ kind: "user" }, { keepInbox: true });
      const stopped = await waitForAgentIdle(agent, invocation.signal);
      if (!stopped) return { kind: "error", text: t("stopFailed") };
    }
    dropPendingSteering(agent);
    if (invocation.signal?.aborted) return { kind: "error", text: t("cancelled") };

    let plan;
    try {
      const target = parseRewindTarget(rawTarget);
      if (target === undefined) throw new RewindError("error.invalidTarget", { raw: rawTarget });
      plan = planRewind(agent.session.snapshotEvents(), agent.session.surface.nodes, target);
    } catch (error) {
      return rewindErrorResult(error);
    }

    let event;
    try {
      event = agent.session.append("user/message", buildMarker(), {
        surfaceOp: { op: "replace", startSeq: plan.surfaceStart, endSeq: plan.surfaceEnd },
        sourceEventSeqs: [...plan.shadowedSeqs]
      });
    } catch (error) {
      return { kind: "error", text: t("failed", { error: error instanceof Error ? error.message : String(error) }) };
    }
    // sourceEventSeq 是 client 重建隐藏区间的锚（与官方 /compact 同构），必须回传
    return { kind: "success", text: t("success", { targetSeq: plan.targetSeq }), sourceEventSeq: event.seq };
  } finally {
    inflight.delete(sessionId);
  }
}

async function handleRewind(invocation, inflight) {
  const session = invocation.agent.session;
  const input = (invocation.rawInput ?? "").trim();
  if (input === "") {
    // 裸 /rewind、/undo = 回退最近一条用户消息
    const candidates = listRewindCandidates(session.snapshotEvents(), session.surface.nodes, 1);
    if (candidates.length === 0) return { kind: "error", text: t("noUserMessages") };
    return executeRewind(invocation, `@${candidates[0].seq}`, inflight);
  }
  const parts = input.split(/\s+/);
  if (parts[0] === "__candidates") {
    const candidates = listRewindCandidates(session.snapshotEvents(), session.surface.nodes);
    return { kind: "success", text: formatCandidateList(candidates) };
  }
  const target = parts[0];
  const mode = parts[1];
  // 与原插件的差异：模式可省略（默认 chat）；v1 不支持 both，明确报错
  if (mode !== undefined && mode !== "chat") {
    return { kind: "error", text: mode === "both" ? t("error.bothUnsupported") : t("engine.rejected") };
  }
  return executeRewind(invocation, target, inflight);
}

/* ------------------------------------------------------------------ *
 * 注册
 * ------------------------------------------------------------------ */
export const name = "my-rewind";
export const inject = ["commands", "settings"];

export function apply(ctx) {
  const inflight = new Set();
  ctx.effect(function* () {
    const rewindHandler = withHostLocale(ctx, (invocation) => handleRewind(invocation, inflight));
    const engineHandler = withHostLocale(ctx, (invocation) =>
      (invocation.rawInput ?? "").trim() === ""
        ? Promise.resolve({ kind: "error", text: t("engine.rejected") })
        : handleRewind(invocation, inflight)
    );
    for (const spec of [
      { name: "rewind", description: () => t("command.description"), handler: rewindHandler },
      { name: "undo", description: () => t("command.undoDescription"), handler: rewindHandler },
      {
        name: ENGINE_COMMAND,
        description: () => t("engine.description"),
        input: { hint: "@<seq> chat | __candidates" },
        handler: engineHandler
      }
    ]) {
      try {
        activeLocale = readHostLocale(ctx);
        yield ctx.commands.register({
          name: spec.name,
          description: spec.description(),
          ...(spec.input === undefined ? {} : { input: spec.input }),
          handler: spec.handler
        });
      } catch (error) {
        ctx.logger.warn(
          `[my-rewind] command "${spec.name}" was not registered: ${error instanceof Error ? error.message : String(error)}`
        );
        if (spec.name === ENGINE_COMMAND) {
          ctx.logger.warn(`[my-rewind] the "${ENGINE_COMMAND}" channel is unavailable; the rewind button and picker will not work.`);
        }
      }
    }
  }, "my-rewind commands");
}
