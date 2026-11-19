import { spawnSync } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ROOTS = ["app", "electron-ipc", "modules", "scripts", "server", "shared", "shard", "tests"];
const EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

async function listFiles(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      files.push(...(await listFiles(target)));
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      files.push(target);
    }
  }
  return files;
}

const files = [];
for (const name of ROOTS) files.push(...(await listFiles(path.join(root, name))));

const failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status === 0) continue;
  failures.push({ file, error: (result.stderr || result.stdout || "").trim() });
}

if (failures.length) {
  for (const { file, error } of failures) {
    console.error(`\n${path.relative(root, file)}\n${error}`);
  }
  console.error(`\n语法检查失败：${failures.length} 个文件。`);
  process.exit(1);
}

console.log(`语法检查通过：${files.length} 个文件。`);
