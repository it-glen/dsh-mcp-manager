#!/usr/bin/env node
/**
 * 单包构建：tsc 只产出 .d.ts，esbuild 从 src/ 源码直接打包出 lib/index.js 与 lib/client.js。
 *
 * 与 monorepo 版 bundle-host 的差异：
 *  - 共享层（src/primitives/）是包内源码，esbuild 打包时自然内联，不需要「d.ts 路径改写 +
 *    副本镜像」那两步（那些机制只为解决跨包相对引用）。
 *  - tsc 设 emitDeclarationOnly：两套 emit 各负责一类产物，不存在目录布局对齐问题。
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(PKG_DIR, "lib");
const pkgJson = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8"));

// 1. 清理旧产物
rmSync(LIB, { recursive: true, force: true });

// 2. tsc 产出 .d.ts（.js 交给 esbuild）
console.log("[build] tsc 生成类型声明...");
execFileSync(
  process.execPath,
  [join(PKG_DIR, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"],
  { cwd: PKG_DIR, stdio: "inherit" },
);

// 3. 宿主端内联：lib/index.js 自包含（共享层与零依赖第三方全部打进单文件）
const bannerJs = pkgJson?.dsh?.bundle?.bannerJs;
console.log("[build] 打包宿主端...");
await build({
  entryPoints: [join(PKG_DIR, "src", "index.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outfile: join(LIB, "index.js"),
  logLevel: "warning",
  charset: "utf8",
  banner: typeof bannerJs === "string" && bannerJs.length > 0 ? { js: bannerJs } : undefined,
});
console.log("[build] lib/index.js 已自包含");

// 4. 客户端打包：lib/client.js
//    产物是浏览器端契约外壳（IIFE + __ModuleLoader__.load 注册 + factory 装配 apply/inject），
//    不是普通 ESM：dsh web 的 loader 以 load id = 完整包名注册模块表，arrive(row) 校验
//    factories.has(包名)。源码是「干净模块」（只导出 apply/inject，无 loader 痕迹），
//    外壳由这里生成——模板只此一处。
const clientEntry = [
  join(PKG_DIR, "src", "client", "index.tsx"),
  join(PKG_DIR, "src", "client", "index.ts"),
].find((p) => existsSync(p));
if (clientEntry === undefined) {
  console.error("[build] 未找到客户端入口 src/client/index.ts(x)");
  process.exit(1);
}
const inlineBareImports = !!(pkgJson.dsh && pkgJson.dsh.client && pkgJson.dsh.client.inlineBareImports);
// 客户端 bare import 的处理与 monorepo 版一致：dsh.client.inlineBareImports 为真则内联，
// 否则宿主注入的 external（react 等）保持外部，经 factory 参数 require 解析。
const EXTERNALS = inlineBareImports
  ? []
  : ["react", "react-dom", "@deepseek-ai/dsh-client-locale/client", "@deepseek-ai/dsh-client-ui-slots"];
console.log("[build] 打包客户端...");
const clientBuilt = await build({
  entryPoints: [clientEntry],
  bundle: true,
  format: inlineBareImports ? "iife" : "cjs",
  platform: "browser",
  target: "es2020",
  write: false,
  external: EXTERNALS,
  loader: { ".css": "text" },
  logLevel: "warning",
  charset: "utf8",
  banner: { js: '"use strict";' },
  define: { __DSH_PLUGIN_ID__: JSON.stringify(pkgJson.name) },
});
const cleanBody = clientBuilt.outputFiles[0].text;
// 契约外壳：external 依赖经 factory 注入的 require 解析（external 的 import 编译成
// require("react")，参数名 require 遮蔽外层，即解析到注入值）。
const contract = inlineBareImports
  ? `"use strict";
window.__ModuleLoader__.load({
  id: ${JSON.stringify(pkgJson.name)},
  factory: function (require) {
    var module = { exports: {} };
${indent(cleanBody, 4)}
    Object.defineProperty(module.exports, Symbol.toStringTag, { value: 'Module' });
    return module.exports;
  }
});
`
  : `"use strict";
window.__ModuleLoader__.load({
  id: ${JSON.stringify(pkgJson.name)},
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
${indent(cleanBody, 4)}
    Object.defineProperty(module.exports, Symbol.toStringTag, { value: 'Module' })
    return module.exports
  }
})
`;
// 契约校验（硬依赖）：load id 必须是字符串字面量且 === 包名；apply/inject 装配必须在。
// define 被遮蔽、占位符拼错、外壳装配出错时构建即失败，不等发布后炸。
const idMatch = contract.match(/__ModuleLoader__\.load\(\s*\{\s*id:\s*"([^"]+)"/);
if (idMatch === null || idMatch[1] !== pkgJson.name) {
  console.error(
    `[build] 客户端契约校验失败：load id 必须等于包名 ${pkgJson.name}（实际: ${idMatch === null ? "缺失" : idMatch[1]}）`,
  );
  process.exit(1);
}
if (!/apply/.test(contract) || !/inject/.test(contract)) {
  console.error("[build] 客户端契约校验失败：产物缺少 exports.apply/exports.inject 装配");
  process.exit(1);
}
writeFileSync(join(LIB, "client.js"), contract);
console.log("[build] lib/client.js 已生成");

console.log("[build] 完成");

/** 逐行缩进（空行不动），供把干净模块内联进 factory 函数体。 */
function indent(text, spaces) {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : ""))
    .join("\n");
}
