import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fsp.readFile(path.join(projectRoot, relative), "utf8");

test("安装窗口选择的语言会写到 ui-locale.txt", async () => {
  const main = await read("electron/main.mjs");
  assert.match(main, /ipcMain\.on\("setup:set-locale"/);
  assert.match(main, /ui-locale\.txt/);
  assert.match(main, /locale === "zh" \? "zh" : "en"/);
  assert.match(main, /runtimePaths\(\)\.root/);
});

test("NSIS 卸载默认英文，并按 ui-locale.txt 切换", async () => {
  const nsh = await read("build/installer.nsh");
  assert.match(nsh, /StrCpy \$R0 "en"/);
  assert.match(nsh, /ui-locale\.txt/);
  assert.match(nsh, /StrCmp \$R2 "zh"/);
  assert.match(nsh, /Uninstalling Pi Flow also removes/);
  assert.match(nsh, /卸载 Pi Flow 会同时删除/);
});

test("清理脚本自己读取语言标记，缺失时默认英文", async () => {
  const ps = await read("scripts/uninstall-runtime.ps1");
  assert.match(ps, /\[string\]\$Locale = ''/);
  assert.match(ps, /ui-locale\.txt/);
  assert.match(ps, /\$Locale = 'en'/);
  assert.match(ps, /function T\(/);
  assert.match(ps, /Pi Flow uninstall cleanup started/);
  assert.match(ps, /Pi Flow uninstall cleanup finished/);
  assert.match(ps, /T 'Python 卸载' 'Python uninstall'/);
});

test("NSIS 标准页面固定英文", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.deepEqual(pkg.build.nsis.installerLanguages, ["en_US"]);
});
