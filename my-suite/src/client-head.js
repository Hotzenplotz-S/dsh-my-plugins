/**
 * MY-Suite 功能合集 —— 共享客户端 bundle（由 build-client.mjs 聚合生成，勿手改）。
 *
 * 门控原理：每个功能行（my-suite/<feature>）的开关状态经
 * ctx.remote.pluginManager.listPlugins() 读取，并订阅 plugin-manager/changed
 * 事件即时增删功能 UI；核心行 my-suite 关闭时整个 bundle 被 dsh-client-modules 卸载。
 */
window.__ModuleLoader__.load({
  id: "my-suite",
  factory(require) {
    /* ---- 作用域收集：把功能注册的所有 effect / slot 注入收进袋子，停用时统一卸载 ---- */
    function scopeCtx(ctx, bag) {
      const scoped = Object.create(ctx);
      scoped.effect = (fn, label) => {
        const dispose = ctx.effect(fn, label);
        if (typeof dispose === "function") bag.push(dispose);
        return dispose;
      };
      const slots = ctx.slots;
      if (slots !== null && typeof slots === "object") {
        const scopedSlots = Object.create(slots);
        scopedSlots.inject = (name, fn) => {
          const dispose = slots.inject(name, fn);
          if (typeof dispose === "function") bag.push(dispose);
          return dispose;
        };
        scoped.slots = scopedSlots;
      }
      if (typeof ctx.inject === "function") {
        scoped.inject = (names, cb) => ctx.inject(names, (inner) => cb(scopeCtx(inner, bag)));
      }
      return scoped;
    }

    /* ---- 功能注册表：moduleName → { start(ctx) → stop() }，由各 FEATURE 段追加 ---- */
    const features = {};
    const running = new Map();
    let pluginCtx = null;

    function pluginManager() {
      if (pluginCtx === null || typeof pluginCtx !== "object") return null;
      const remote = pluginCtx.remote !== undefined ? pluginCtx.remote
        : (typeof pluginCtx.get === "function" ? pluginCtx.get("remote") : null);
      return remote === null || remote === undefined ? null : (remote.pluginManager ?? null);
    }

    function startFeature(name) {
      try {
        running.set(name, features[name].start(pluginCtx) ?? null);
        console.log(`[my-suite] feature started: ${name}`);
      } catch (error) { console.error(`[my-suite] start ${name} failed`, error); running.set(name, null); }
    }

    function stopFeature(name) {
      const stop = running.get(name);
      running.delete(name);
      if (typeof stop === "function") {
        try { stop(); } catch (error) { console.warn(`my-suite: stop ${name} failed`, error); }
      }
    }

    // 先无条件启动全部功能（fail-open：行状态读不到时按开启处理，
    // 保证 remote 服务形态变化也不会让功能消失），remote 就绪后再按行状态校准。
    function startAll() {
      for (const name of Object.keys(features)) {
        if (!running.has(name)) startFeature(name);
      }
    }

    async function refresh() {
      if (pluginCtx === null) return;
      const mgr = pluginManager();
      if (mgr === null) return; // remote 不可用：保持 fail-open 状态
      let rows;
      try { rows = await mgr.listPlugins(); } catch (error) { console.warn("my-suite: listPlugins failed", error); return; }
      const state = new Map();
      for (const row of Array.isArray(rows) ? rows : []) {
        if (row !== null && typeof row === "object" && typeof row.moduleName === "string") {
          state.set(row.moduleName, row.enabled !== false);
        }
      }
      for (const name of Object.keys(features)) {
        const on = state.get(name) !== false; // 查不到时按开启处理
        const active = running.has(name);
        if (on && !active) startFeature(name);
        else if (!on && active) stopFeature(name);
      }
    }

    function apply(ctx) {
      if (typeof document === "undefined") return;
      pluginCtx = ctx;
      console.log("[my-suite] apply: starting all features", Object.keys(features));
      ctx.effect(() => {
        startAll();
        void refresh();
        let off = null;
        const subscribe = (remote) => {
          if (remote !== null && typeof remote === "object" && typeof remote.$on === "function" && off === null) {
            off = remote.$on("plugin-manager/changed", () => { void refresh(); });
            void refresh(); // remote 就绪后立即按真实行状态校准一次
          }
        };
        try {
          subscribe(ctx.remote !== undefined ? ctx.remote
            : (typeof ctx.get === "function" ? ctx.get("remote") : null));
          // remote 可能作为注入服务晚到：经 ctx.inject 等它就位
          if (off === null && typeof ctx.inject === "function") {
            ctx.inject(["remote"], (inner) => { subscribe(inner && inner.remote); });
          }
        } catch (error) { /* 事件订阅失败不致命：功能已 fail-open 启动 */ }
        // 兜底：remote 未就绪时补一次晚到的首刷
        const timer = setTimeout(() => { void refresh(); }, 2000);
        return () => {
          clearTimeout(timer);
          if (typeof off === "function") { try { off(); } catch (error) { /* noop */ } }
          for (const stop of running.values()) {
            if (typeof stop === "function") { try { stop(); } catch (error) { /* noop */ } }
          }
          running.clear();
        };
      }, "my-suite: feature gating");
    }
