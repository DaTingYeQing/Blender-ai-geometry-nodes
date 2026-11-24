import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requested = process.argv[2] || "all";
const suites = requested === "all" ? ["server", "ui"] : [requested];

/** Windows 与 Linux 都能找到 tests/server、tests/UI（目录名大小写不敏感匹配）。 */
async function resolveSuiteDir(suite) {
  const testsRoot = path.join(root, "tests");
  let entries;
  try {
    entries = await fsp.readdir(testsRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  const match = entries.find(
    (entry) => entry.isDirectory() && entry.name.toLowerCase() === suite.toLowerCase(),
  );
  return match ? path.join(testsRoot, match.name) : null;
}

const files = [];
const appExists = await fsp.access(path.join(root, "app")).then(
  () => true,
  () => false,
);
for (const suite of suites) {
  if (suite === "ui" && !appExists) {
    if (requested !== "all") {
      console.error("app/ 不存在，UI 层已被移除，无法运行 UI 测试。");
      process.exit(1);
    }
    continue;
  }
  const dir = await resolveSuiteDir(suite);
  if (!dir) {
    if (requested !== "all") {
      console.error(`没有 tests/${suite}，无法运行 ${suite} 测试。`);
      process.exit(1);
    }
    continue;
  }
  for (const name of (await fsp.readdir(dir)).sort()) {
    if (name.endsWith(".test.mjs")) files.push(path.join(dir, name));
  }
}

const strayTests = (await fsp.readdir(path.join(root, "tests"), { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
  .map((entry) => `tests/${entry.name}`);
if (strayTests.length) {
  console.error(`测试文件必须放在 tests/server 或 tests/UI：${strayTests.join("、")}`);
  process.exit(1);
}

if (!files.length) {
  console.error("没有可运行的测试。");
  process.exit(1);
}

const child = spawn(process.execPath, ["--test", ...files], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
