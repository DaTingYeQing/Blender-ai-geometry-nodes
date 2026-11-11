import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { listFiles, projectRoot } from "./asset-utils.mjs";

const stylesRoot = path.join(projectRoot, "app", "styles");
const modulesRoot = path.join(projectRoot, "modules");

const LEGACY_REFS =
  /var\(--(?:bg|panel|panel-2|border|border-soft|text|muted|accent|accent-2|warn|danger|node|chrome|paper|rail|row-flat|row-raised|row-active|card|well|map-body|ink|ink-2|ink-3|accent-paper|accent-paper-2|line|rule|lip|lip-dark|hi|radius|radius-sm)\)/;
const LEGACY_DEFS =
  /^\s*--(?:bg|panel|panel-2|border|border-soft|text|muted|accent|accent-2|warn|danger|node|chrome|paper|rail|row-flat|row-raised|row-active|card|well|map-body|ink|ink-2|ink-3|accent-paper|accent-paper-2|line|rule|lip|lip-dark|hi|radius|radius-sm)\s*:/m;
const LEGACY_SELECTORS =
  /(?:^|[\s,{}])\.(btn|icon-btn|link-btn|field|field-row|radio|switch|segmented|seg-thumb|seg-dot|modal|modal-backdrop|toast|artifact|empty-box|hint|kv|insp-close|status-pill)(?=[\s,{.:])/m;
const DYNAMIC_VARS = new Set(["--hue", "--c", "--c-dark", "--c-light", "--node-w", "--node-h"]);

async function exists(file) {
  return fsp.access(file).then(
    () => true,
    () => false,
  );
}

test("样式只剩 tokens / layout / ui 三层，旧文件和深色变量已删除", async () => {
  const files = (await listFiles(stylesRoot, [".css"])).map((file) => path.basename(file)).sort();
  assert.deepEqual(files, ["layout.css", "tokens.css", "ui.css"]);

  for (const file of ["components.css", "modal.css"]) {
    assert.equal(await exists(path.join(stylesRoot, file)), false, `旧样式不应存在：${file}`);
  }
  assert.equal(await exists(path.join(modulesRoot, "flow", "web", "slider.mjs")), false);

  const tokens = await fsp.readFile(path.join(stylesRoot, "tokens.css"), "utf8");
  assert.doesNotMatch(tokens, LEGACY_DEFS, "tokens.css 仍定义了旧变量");
});

test("index.html 只加载公共 UI 样式，并使用 ui-toast", async () => {
  const html = await fsp.readFile(path.join(projectRoot, "app", "index.html"), "utf8");
  for (const file of ["tokens.css", "layout.css", "ui.css"]) {
    assert.match(html, new RegExp(`/app/styles/${file}`), `index.html 未加载 ${file}`);
  }
  for (const file of ["components.css", "modal.css"]) {
    assert.doesNotMatch(html, new RegExp(`/app/styles/${file}`), `index.html 仍加载 ${file}`);
  }
  assert.match(html, /class="ui-toast"/);
  assert.match(html, /id="toast"[^>]*role="status"[^>]*aria-live="polite"/);
});

test("公共弹窗行为包含 ARIA 与焦点管理", async () => {
  const source = await fsp.readFile(path.join(projectRoot, "app", "js", "ui", "modal.mjs"), "utf8");
  assert.match(source, /role", "dialog"/);
  assert.match(source, /aria-modal/);
  assert.match(source, /aria-labelledby/);
  assert.match(source, /FOCUSABLE/);
  assert.match(source, /event\.key !== "Tab"/);
});

test("模块 CSS 不再引用旧变量或重定义公共交互件", async () => {
  const cssFiles = await listFiles(modulesRoot, [".css"]);
  assert.ok(cssFiles.length > 0);

  for (const file of cssFiles) {
    const source = await fsp.readFile(file, "utf8");
    const relative = path.relative(projectRoot, file);
    assert.doesNotMatch(source, LEGACY_REFS, `${relative} 引用了旧变量`);
    assert.doesNotMatch(source, LEGACY_SELECTORS, `${relative} 重定义了公共交互件`);
  }
});

test("模块 CSS 的 var() 都能解析到 tokens 或文件内定义", async () => {
  const tokens = await fsp.readFile(path.join(stylesRoot, "tokens.css"), "utf8");
  const defined = new Set(
    [...tokens.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((match) => match[1]),
  );
  for (const name of DYNAMIC_VARS) defined.add(name);

  const files = [
    ...(await listFiles(stylesRoot, [".css"])),
    ...(await listFiles(modulesRoot, [".css"])),
  ];

  for (const file of files) {
    const source = await fsp.readFile(file, "utf8");
    const local = new Set([...source.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((match) => match[1]));
    const allowed = new Set([...defined, ...local]);
    for (const match of source.matchAll(/var\((--[\w-]+)/g)) {
      assert.ok(allowed.has(match[1]), `${path.relative(projectRoot, file)} 引用了未定义变量 ${match[1]}`);
    }
  }
});

test("moveThumb 只有公共实现，模块不再各自复制", async () => {
  const files = await listFiles(modulesRoot, [".mjs"]);
  for (const file of files) {
    const source = await fsp.readFile(file, "utf8");
    assert.doesNotMatch(source, /function moveThumb/, `${path.relative(projectRoot, file)} 复制了 moveThumb`);
  }
});

test("节点尺寸只有 state.mjs 一个来源", async () => {
  const canvasCss = await fsp.readFile(
    path.join(modulesRoot, "flow", "web", "canvas.css"),
    "utf8",
  );
  assert.match(canvasCss, /\.node\s*\{[\s\S]*?width:\s*var\(--node-w\)/);
  assert.match(canvasCss, /\.node\s*\{[\s\S]*?height:\s*var\(--node-h\)/);
  assert.doesNotMatch(canvasCss, /width:\s*236px|height:\s*95px/);

  const canvasMjs = await fsp.readFile(
    path.join(modulesRoot, "flow", "web", "canvas.mjs"),
    "utf8",
  );
  assert.match(canvasMjs, /setProperty\("--node-w", `\$\{NODE_W\}px`\)/);
  assert.match(canvasMjs, /setProperty\("--node-h", `\$\{NODE_H\}px`\)/);

  const state = await fsp.readFile(path.join(modulesRoot, "flow", "web", "state.mjs"), "utf8");
  assert.match(state, /export const NODE_W = 236;/);
  assert.match(state, /export const NODE_H = 95;/);
});

test("公共 UI 入口导出完整原语", async () => {
  const kit = await import("../app/js/ui/index.mjs");
  assert.deepEqual(Object.keys(kit).sort(), [
    "bindModal",
    "bindSegmented",
    "bindSwitch",
    "confirmDialog",
    "createModal",
    "createThumbTracker",
    "moveThumb",
    "segmentedMarkup",
    "switchMarkup",
  ]);
});
