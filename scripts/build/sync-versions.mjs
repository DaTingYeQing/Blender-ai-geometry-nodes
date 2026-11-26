// 构建前同步两个工具的版本标记：用压缩包内容哈希，避免“内容变了但标签没变”。
//
//   node scripts/build/sync-versions.mjs          写入 shard/versions.json
//   node scripts/build/sync-versions.mjs --check  只校验，不一致退出 1
//
// 只改 blenderBuild / covtraceVersion；程序版本、runtimeLayout、configVersion、
// dataSchemaVersion 都不动。
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ASSETS = path.join(ROOT, "resources", "blender");
const VERSIONS = path.join(ROOT, "shard", "versions.json");
const CHECK = process.argv.includes("--check");

async function hashFile(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    fs.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .once("end", resolve)
      .once("error", reject);
  });
  return hash.digest("hex");
}

async function marker(prefix, file) {
  const full = path.join(ASSETS, file);
  if (!fs.existsSync(full)) throw new Error(`缺少运行时包：${full}`);
  const digest = await hashFile(full);
  return `${prefix}-${digest.slice(0, 12)}`;
}

const current = JSON.parse((await fsp.readFile(VERSIONS, "utf8")).replace(/^\uFEFF/, ""));
const next = {
  ...current,
  blenderBuild: await marker("b", "blender-4.5.0-trace-win64.zip"),
  covtraceVersion: await marker("c", "covtrace-toolchain.zip"),
};

if (CHECK) {
  if (current.blenderBuild !== next.blenderBuild || current.covtraceVersion !== next.covtraceVersion) {
    console.error(
      "两个工具的版本标记与压缩包不一致：\n"
      + `  blenderBuild:   ${current.blenderBuild} -> ${next.blenderBuild}\n`
      + `  covtraceVersion: ${current.covtraceVersion} -> ${next.covtraceVersion}\n`
      + "先运行 npm run versions:sync，或直接 npm run pack。",
    );
    process.exit(1);
  }
  console.log("工具版本标记校验通过");
  process.exit(0);
}

const output = JSON.stringify(next, null, 2) + "\n";
await fsp.writeFile(VERSIONS, output, "utf8");
if (current.blenderBuild !== next.blenderBuild || current.covtraceVersion !== next.covtraceVersion) {
  console.log(`已同步工具版本：Blender ${next.blenderBuild}，CovTrace ${next.covtraceVersion}`);
} else {
  console.log("工具版本标记无变化");
}
