import path from "node:path";
import { createServer } from "./http.mjs";

const port = Number(process.env.PORT || 4173);

/* UI 目录默认是仓库里的 app/。开发时可以用 PI_FLOW_UI_DIR 指到仓库外的 UI，
 * 让页面和 /api/* 走同一个端口，省掉跨域和另外起一个静态服务。 */
const appDir = process.env.PI_FLOW_UI_DIR
  ? path.resolve(process.env.PI_FLOW_UI_DIR)
  : undefined;

function logDiagnostics(diagnostics) {
  for (const warning of diagnostics?.warnings || []) console.warn(`[registry] ${warning}`);
  for (const item of diagnostics?.skipped || []) {
    console.warn(`[registry] 跳过 ${item.project}：${item.reason}${item.path ? `（${item.path}）` : ""}`);
  }
}

const { url, server, apis } = await createServer({ port, host: "127.0.0.1", appDir });

/** 开发服务器也走与桌面端相同的首次播种：Agent 清单 + 默认流程。 */
const seeded = await apis.registry.seedDev({
  presetPath: path.join(apis.store.ROOT_DIR, "presets", "default-flow.json"),
});
logDiagnostics(seeded.diagnostics);
if (seeded.single) process.env.PI_FLOW_SINGLE_AGENT = seeded.single;
if (seeded.changed) console.log("[registry] Agent / 预设已更新");

console.log(`Pi Flow 已启动：${url}`);
console.log("（Node 调试模式：只提供 /api/*；把 UI 放到 appDir 后才会提供静态页）");

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
