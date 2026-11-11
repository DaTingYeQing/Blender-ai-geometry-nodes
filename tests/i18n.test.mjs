import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { EN, resolveLocale, setLocale, t } from "../app/js/core/i18n.mjs";
import { statusLabel } from "../modules/flow/web/state.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CJK = /[\u4e00-\u9fff]/;

async function listFiles(dir) {
  const found = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await listFiles(full)));
    else if (/\.(mjs|cjs|html)$/.test(entry.name)) found.push(full);
  }
  return found;
}

function literalKeys(source) {
  const keys = [];
  for (const match of source.matchAll(/\bt\(\s*("(?:[^"\\]|\\.)*")/g)) {
    keys.push(JSON.parse(match[1]));
  }
  return keys;
}

function staticKeys(source) {
  const keys = [];
  for (const match of source.matchAll(/data-i18n(?:-title|-aria|-placeholder)?="([^"]+)"/g)) {
    keys.push(match[1]);
  }
  return keys;
}

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

test("所有 t() 文案和静态 data-i18n 都有英文条目", async () => {
  const roots = ["app/js", "modules", "electron"];
  const files = (
    await Promise.all(roots.map((root) => listFiles(path.join(projectRoot, root))))
  )
    .flat()
    .filter(
      (file) =>
        !file.endsWith(path.join("core", "i18n.mjs")) &&
        !file.endsWith(path.join("electron", "setup.html")),
    );
  files.push(path.join(projectRoot, "app", "index.html"));

  const missing = new Set();
  for (const file of files) {
    const source = await fsp.readFile(file, "utf8");
    for (const key of [...literalKeys(source), ...staticKeys(source)]) {
      if (!(key in EN)) missing.add(`${path.relative(projectRoot, file)}：${key}`);
    }
  }
  assert.deepEqual([...missing], []);
});

test("英文条目不残留中文，占位符与中文原文一致", () => {
  for (const [key, value] of Object.entries(EN)) {
    assert.equal(typeof value, "string", key);
    assert.ok(value.trim(), `${key} 的英文为空`);
    assert.doesNotMatch(value, CJK, `${key} 的英文里还有中文`);
    assert.deepEqual(placeholders(value), placeholders(key), `${key} 的占位符不一致`);
  }
});

test("切换语言后 t() 与动态状态文案都变英文", () => {
  setLocale("en");
  try {
    assert.equal(t("加载失败：{message}", { message: "x" }), "Failed to load: x");
    assert.equal(statusLabel("running"), "Running");
    assert.equal(t("不存在的文案"), "不存在的文案");
    assert.equal(t("确定删除「{name}」吗？", { name: "A" }), "Delete “A”?");
  } finally {
    setLocale("zh");
  }
  assert.equal(t("加载失败：{message}", { message: "x" }), "加载失败：x");
  assert.equal(statusLabel("done"), "已完成");
});

test("首次进入默认英文，已选语言优先", () => {
  assert.equal(resolveLocale(null, true), "en");
  assert.equal(resolveLocale("", true), "en");
  assert.equal(resolveLocale("en", true), "en");
  assert.equal(resolveLocale("zh", true), "zh");
  assert.equal(resolveLocale(null, false), "zh");
});

test("顶栏语言滑块接在公共分段控件上", async () => {
  const html = await fsp.readFile(path.join(projectRoot, "app", "index.html"), "utf8");
  assert.match(html, /id="langSwitch"[^>]*class="ui-segmented lang-switch"/);
  assert.match(html, /data-value="zh"[\s\S]*data-value="en"/);
  const shell = await fsp.readFile(path.join(projectRoot, "app", "js", "shell.mjs"), "utf8");
  assert.match(shell, /bindSegmented\(\$\("#langSwitch"\)/);
  assert.match(shell, /setLocale\(next\)/);
});
