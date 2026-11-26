// 打包入口：一条命令产出在线版或完整离线版。
//
//   npm run pack        → 在线版：release/（不含 Blender/CovTrace）+ assets + update.json
//   npm run pack:full   → 完整离线版：release/full/（含全部运行时）
//
// --dry-run 只打印步骤，不执行。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const FULL = process.argv.includes("--full");
const DRY = process.argv.includes("--dry-run");

const output = FULL ? "release/full" : "release";
const cleanDir = path.join(output, "win-unpacked");

const steps = [
  {
    label: "同步两个工具的版本标记",
    cmd: process.execPath,
    args: ["scripts/build/sync-versions.mjs"],
  },
  {
    label: "校验离线小工具",
    cmd: process.execPath,
    args: ["scripts/build/fetch-bundles.mjs", "--check"],
  },
  {
    label: FULL ? "构建完整离线版" : "构建在线版",
    cmd: process.execPath,
    args: [
      "node_modules/electron-builder/cli.js",
      "--win",
      "--config",
      "electron-builder.config.cjs",
    ],
  },
  ...(FULL
    ? []
    : [{
      label: "生成 update.json 并铺开运行时包",
      cmd: process.execPath,
      args: ["scripts/build/update-manifest.mjs"],
    }]),
  {
    label: "清理 win-unpacked",
    cmd: process.execPath,
    args: ["scripts/build/clean-release.mjs", cleanDir],
  },
];

const env = { ...process.env, PI_FLOW_FULL: FULL ? "1" : "0" };

function run(step) {
  console.log(`\n[pack] ${step.label}`);
  console.log(`       ${path.basename(step.cmd)} ${step.args.join(" ")}`);
  if (DRY) return true;
  const result = spawnSync(step.cmd, step.args, {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`[pack] 失败：${result.error.message}`);
    return false;
  }
  if (result.status !== 0) {
    console.error(`[pack] 失败：退出码 ${result.status}`);
    return false;
  }
  return true;
}

for (const step of steps) {
  if (!run(step)) process.exit(1);
}

/* 完整版的 latest.yml / blockmap 只对 electron-updater 有意义；
 * 完整包不走自动更新，留着容易和在线版混淆。 */
if (FULL && !DRY) {
  const dir = path.join(ROOT, output);
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name === "latest.yml" || name.endsWith(".blockmap")) {
        fs.rmSync(path.join(dir, name), { force: true });
      }
    }
  } catch {
    // 目录不存在或删不掉不影响安装包本身。
  }
}

if (!FULL) {
  console.warn(
    "\n[pack] 注意：在线版不含 Blender / CovTrace。"
    + "\n       运行时已经完整的用户可以直接更新；全新安装还需要下载器（下一步接入）。"
    + "\n       要给新用户/内网使用，请用 npm run pack:full。",
  );
}

console.log(`\n[pack] 完成：${path.join(ROOT, output)}`);
