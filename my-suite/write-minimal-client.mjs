// write-minimal-client.mjs — 生成无 BOM 的最小化 client.js
import { readFileSync, writeFileSync } from "fs";
const content = `/**
 * MY-Suite — 最小化测试版 v0.3.1
 * 只做一件事：注册 bundle，看管道通不通。
 */
window.__ModuleLoader__.load({
  id: "my-suite",
  factory(require) {
    console.log("[my-suite-test] factory materialized");
    return {
      inject: ["slots", "locale"],
      apply(ctx) {
        console.log("[my-suite-test] apply called", typeof ctx.effect);
        ctx.effect(() => {
          console.log("[my-suite-test] effect running — pipeline OK");
          return () => {};
        });
      }
    };
  }
});
`;
writeFileSync("client.js", content, "utf8");
const b = readFileSync("client.js");
console.log("written", b.length, "bytes, BOM:", b[0] === 0xef ? "YES (bad)" : "NO (ok)");