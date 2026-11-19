import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fsp.readFile(path.join(projectRoot, relative), "utf8");

test("重跑安装继承上一份归属清单，失败时也保留", async () => {
  const engine = await read("scripts/setup/engine.ps1");
  assert.match(engine, /Test-Path -LiteralPath \$resultPath/);
  assert.match(engine, /previous\.piInstalled/);
  assert.match(engine, /previous\.nodeInstalled/);
  assert.match(engine, /previous\.pythonInstalled/);
  assert.match(engine, /function Get-ManagedSnapshot/);
  assert.match(engine, /ok\s+=\s+\$false[\s\S]*?managed\s+=\s+Get-ManagedSnapshot/);

  const tools = await read("scripts/setup/cards/50-tools.ps1");
  assert.match(tools, /elseif \(\$setup\.Managed\.Tools\[\$Name\] -ne 'created'/);
});

test("清理脚本在安装开始时复制，且每次启动刷新", async () => {
  const engine = await read("scripts/setup/engine.ps1");
  const start = engine.indexOf("function Start-SetupEngine");
  assert.ok(start >= 0, "找不到 Start-SetupEngine");
  const copy = engine.indexOf("Install-CleanupScript", start);
  const cards = engine.indexOf("foreach ($card in $cards)", start);
  assert.ok(copy > 0 && cards > 0 && copy < cards, "清理脚本必须在跑卡片之前复制");

  const runtime = await read("electron-ipc/runtime.mjs");
  assert.match(runtime, /async function refreshCleanupScript/);
  assert.match(runtime, /refreshCleanupScript\(\);\s*\n\s*\n?\s*let info = await inspectRuntime/);
  assert.match(runtime, /copyFile\(source, path\.join\(root, "uninstall-runtime\.ps1"\)\)/);
});

test("卸载日志在 %TEMP%，失败以非 0 退出", async () => {
  const ps = await read("scripts/uninstall-runtime.ps1");
  assert.match(ps, /\$logFile = Join-Path \$env:TEMP 'PiFlow-uninstall\.log'/);
  assert.match(ps, /\$script:Failures = 0/);
  assert.match(ps, /if \(\$script:Failures -gt 0\)[\s\S]*?exit 1/);
  assert.match(ps, /if \(\$managed\.pythonInstalled\)/);
  assert.doesNotMatch(ps, /\$item\.Name -eq \$selfName -or/);
});

test("NSIS 在清理失败或脚本缺失时提示", async () => {
  const nsh = await read("scripts/installer/installer.nsh");
  assert.match(nsh, /StrCpy \$R3 "missing"/);
  assert.match(nsh, /StrCmp \$R3 "0" piflow_cleanup_ok/);
  assert.match(nsh, /%TEMP%\\PiFlow-uninstall\.log/);
  assert.match(nsh, /卸载清理脚本缺失/);
});
