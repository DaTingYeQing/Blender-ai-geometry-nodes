import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CJK = /[\u4e00-\u9fff]/;

async function loadSetupI18n() {
  const source = await fsp.readFile(path.join(projectRoot, "electron", "setup-i18n.js"), "utf8");
  const sandbox = {};
  vm.runInNewContext(source, sandbox);
  return sandbox;
}

async function read(relative) {
  return fsp.readFile(path.join(projectRoot, relative), "utf8");
}

test("安装页静态文案和 t() 都有英文条目", async () => {
  const { SETUP_I18N } = await loadSetupI18n();
  const html = await read("electron/setup.html");
  const keys = new Set();

  for (const match of html.matchAll(/data-i18n(?:-title|-aria)?="([^"]+)"/g)) {
    keys.add(match[1]);
  }
  for (const match of html.matchAll(/\bt\(\s*("(?:[^"\\]|\\.)*")/g)) {
    keys.add(JSON.parse(match[1]));
  }
  for (const key of ["正在检查运行环境…", "准备安装运行环境…", "准备完成，正在启动…"]) {
    keys.add(key);
  }

  const missing = [...keys].filter((key) => !(key in SETUP_I18N));
  assert.deepEqual(missing, []);
});

test("安装脚本的步骤标题都有英文", async () => {
  const { SETUP_I18N } = await loadSetupI18n();
  const dir = path.join(projectRoot, "scripts", "setup", "cards");
  const files = (await fsp.readdir(dir)).filter((name) => name.endsWith(".ps1"));
  const titles = [];
  for (const file of files) {
    const source = await fsp.readFile(path.join(dir, file), "utf8");
    for (const match of source.matchAll(/^\s*Title\s*=\s*'([^']+)'/gm)) titles.push(match[1]);
  }
  assert.ok(titles.length >= 7);
  assert.deepEqual(
    titles.filter((title) => !(title in SETUP_I18N)),
    [],
  );

  const preview = await read("electron/setup-preview.mjs");
  const array = preview.match(/const steps = \[([\s\S]*?)\];/);
  assert.ok(array, "找不到预览步骤");
  const previewTitles = [...array[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(previewTitles.length >= 5);
  assert.deepEqual(
    previewTitles.filter((title) => !(title in SETUP_I18N)),
    [],
  );
});

test("安装页英文不残留中文，默认英文", async () => {
  const { SETUP_I18N, resolveSetupLocale } = await loadSetupI18n();
  for (const [key, value] of Object.entries(SETUP_I18N)) {
    assert.ok(value.trim(), `${key} 的英文为空`);
    assert.doesNotMatch(value, CJK, `${key} 的英文里还有中文`);
  }
  assert.equal(resolveSetupLocale(null), "en");
  assert.equal(resolveSetupLocale("en"), "en");
  assert.equal(resolveSetupLocale("zh"), "zh");
});

test("安装窗口有语言滑块并同步主进程", async () => {
  const html = await read("electron/setup.html");
  assert.match(html, /id="langSwitch" class="lang-switch"/);
  assert.match(html, /data-lang="zh"[\s\S]*data-lang="en"/);
  assert.match(html, /class="lang-btn active"[^>]*data-lang="en"/);
  assert.match(html, /window\.setup\?\.setLocale\?\.\(lang\)/);

  const preload = await read("electron/setup-preload.cjs");
  assert.match(preload, /setLocale: \(locale\) => ipcRenderer\.send\("setup:set-locale"/);

  const main = await read("electron/main.mjs");
  assert.match(main, /ipcMain\.on\("setup:set-locale"/);
  assert.match(main, /setLocale\("en"\)/);
});
