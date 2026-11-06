#!/usr/bin/env node
/**
 * MY-Suite 客户端聚合构建：把 features/<name>/client.js 逐个包成
 * create<Name>Feature(require)，嵌入门控框架（src/client-head.js + client-tail.js），
 * 输出单文件 client.js。
 *
 * 约定：feature 文件是一个完整模块体，内部声明 `function apply(ctx)`（约定与
 * 独立插件 factory 体内一致），且**不得**自带 return；构建器自动追加
 * start/stop —— start 经 scopeCtx 收集该功能注册的全部 effect/slot disposer，
 * 行开关关闭时统一卸载，实现即时生效。
 *
 * 用法：node build-client.mjs（在 plugins/my-suite 目录下）。
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));
const cap = (s) => s.charAt(0).toUpperCase() + s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()).slice(1);

const features = readdirSync(join(root, "features"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

let out = readFileSync(join(root, "src/client-head.js"), "utf8");
const registered = [];
for (const name of features) {
  const body = readFileSync(join(root, "features", name, "client.js"), "utf8");
  if (!/function\s+apply\s*\(\s*ctx\s*\)/.test(body)) {
    throw new Error(`features/${name}/client.js 缺少 function apply(ctx)，不符合聚合约定`);
  }
  const fn = `create${cap(name)}Feature`;
  out += `\n    /* ==== FEATURE ${name} ==== */\n`;
  out += `    function ${fn}(require) {\n`;
  out += body.replace(/\s+$/, "");
  out += `\n      function start(ctx) {\n`;
  out += `        const bag = [];\n`;
  out += `        apply(scopeCtx(ctx, bag));\n`;
  out += `        return () => {\n`;
  out += `          for (const dispose of bag.splice(0).reverse()) {\n`;
  out += `            try { dispose(); } catch (error) { console.warn("my-suite: ${name} dispose failed", error); }\n`;
  out += `          }\n`;
  out += `        };\n`;
  out += `      }\n`;
  out += `      return { start };\n`;
  out += `    }\n`;
  registered.push({ name, fn });
}
out += `\n`;
for (const { name, fn } of registered) {
  out += `    features["my-suite/${name}"] = ${fn}(require);\n`;
}
out += readFileSync(join(root, "src/client-tail.js"), "utf8");

writeFileSync(join(root, "client.js"), out, "utf8");
console.log(`client.js built: ${out.length} chars, features: ${registered.map((r) => r.name).join(", ") || "(none)"}`);
