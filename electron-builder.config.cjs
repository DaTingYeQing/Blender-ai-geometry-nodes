/* ===== electron-builder 配置 =====
 * 同一份 package.json build 配置，按 PI_FLOW_FULL 切换：
 *   PI_FLOW_FULL=1 → 完整离线版（含 Blender/CovTrace，输出 release/full/）
 *   其它           → 在线版（不含 resources/blender，输出 release/）
 *
 * 这样开发时只有一份配置，避免在线版 / 离线版漂移。
 */
const pkg = require("./package.json");

const full = process.env.PI_FLOW_FULL === "1";
const config = JSON.parse(JSON.stringify(pkg.build || {}));

config.extraResources = (config.extraResources || []).filter((item) => {
  if (full) return true;
  const from = String(item.from || "").replace(/\\/g, "/");
  return from !== "resources/blender";
});

config.artifactName = full
  ? "Pi Flow Setup Full ${version}.${ext}"
  : "Pi Flow Setup ${version}.${ext}";

if (full) {
  config.directories = { ...(config.directories || {}), output: "release/full" };
}

module.exports = config;
