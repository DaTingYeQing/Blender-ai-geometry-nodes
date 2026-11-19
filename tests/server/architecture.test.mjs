import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importSpecifiers, listFiles, projectRoot } from "../asset-utils.mjs";

const APP_ROOT = path.join(projectRoot, "app");
const HOST_ROOT = path.join(APP_ROOT, "src", "host");
const SERVER_ROOT = path.join(projectRoot, "server");
const MODULES_ROOT = path.join(projectRoot, "modules");
const SHARED_ROOT = path.join(projectRoot, "shared");
const ELECTRON_ROOT = path.join(projectRoot, "electron-ipc");
const MODULE_NAMES = ["agents", "flow", "runtime", "artifacts", "pi"];

const inside = (root, file) => {
  const rel = path.relative(root, file);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

async function filesIn(root) {
  return fsp.access(root).then(
    () => listFiles(root, [".mjs", ".js"]),
    () => [],
  );
}

const existingRoots = async (roots) => {
  const out = [];
  for (const root of roots) {
    if (await fsp.access(root).then(() => true, () => false)) out.push(root);
  }
  return out;
};

test("所有相对 import 都有目标", async () => {
  const missing = [];
  for (const root of await existingRoots([APP_ROOT, SERVER_ROOT, MODULES_ROOT, SHARED_ROOT, ELECTRON_ROOT])) {
    for (const file of await filesIn(root)) {
      const source = await fsp.readFile(file, "utf8");
      for (const specifier of importSpecifiers(source)) {
        if (!specifier.startsWith(".")) continue;
        const resolved = path.resolve(path.dirname(file), specifier);
        await fsp.stat(resolved).catch(() => {
          missing.push(`${path.relative(projectRoot, file)} -> ${specifier}`);
        });
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("第二层模块只从根入口公开 createServer", async () => {
  for (const name of MODULE_NAMES) {
    const publicModule = await import(`../../modules/${name}/index.mjs`);
    assert.deepEqual(Object.keys(publicModule).sort(), ["createServer"], `${name} 暴露了视图入口`);
    await import(`../../modules/${name}/server/index.mjs`);
  }
});

test("第二层不得引用 app/ 或任何 web 视图", async () => {
  const lines = [];
  for (const root of [SERVER_ROOT, MODULES_ROOT, SHARED_ROOT, ELECTRON_ROOT]) {
    for (const file of await listFiles(root)) {
      const source = await fsp.readFile(file, "utf8");
      for (const specifier of importSpecifiers(source)) {
        if (!specifier.startsWith(".")) continue;
        const resolved = path.resolve(path.dirname(file), specifier);
        if (inside(APP_ROOT, resolved) || /[\\/]web[\\/]/.test(resolved)) {
          lines.push(`${path.relative(projectRoot, file)} -> ${specifier}`);
        }
      }
    }
  }
  assert.deepEqual(lines, []);
});

test("UI 只依赖 app/ 与 shared/，不引用服务端内部", async () => {
  const lines = [];
  for (const file of await filesIn(APP_ROOT)) {
    const source = await fsp.readFile(file, "utf8");
    for (const specifier of importSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      const resolved = path.resolve(path.dirname(file), specifier);
      if (inside(SERVER_ROOT, resolved) || inside(MODULES_ROOT, resolved) || inside(ELECTRON_ROOT, resolved)) {
        lines.push(`${path.relative(projectRoot, file)} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(lines, []);
});

test("UI 的 HTTP 调用只出现在宿主适配层", async () => {
  const offenders = [];
  for (const file of await filesIn(APP_ROOT)) {
    if (inside(HOST_ROOT, file)) continue;
    const source = await fsp.readFile(file, "utf8");
    if (/\bfetch\s*\(/.test(source)) offenders.push(path.relative(projectRoot, file));
  }
  assert.deepEqual(offenders, []);
});

test("UI 不硬编码 API 路径", async () => {
  const clientFile = path.join(HOST_ROOT, "api.js");
  const offenders = [];
  for (const file of await filesIn(APP_ROOT)) {
    if (file === clientFile) continue;
    const source = await fsp.readFile(file, "utf8");
    if (/["'`]\/api\//.test(source)) offenders.push(path.relative(projectRoot, file));
  }
  assert.deepEqual(offenders, []);
});

test("引擎和通用组件库不认识业务字段", async () => {
  const roots = [
    path.join(APP_ROOT, "src", "core"),
    path.join(APP_ROOT, "src", "app"),
    path.join(APP_ROOT, "src", "library", "components"),
    path.join(APP_ROOT, "src", "library", "combos"),
  ];
  const terms = ["agentId", "flowId", "sessionId", "sessionMode"];
  const offenders = [];
  for (const root of roots) {
    for (const file of await filesIn(root)) {
      const source = await fsp.readFile(file, "utf8");
      for (const term of terms) {
        if (source.includes(term)) offenders.push(`${path.relative(projectRoot, file)}：${term}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("工具层只允许从 server/tools 进入第二层", async () => {
  const offenders = [];
  const roots = [SERVER_ROOT, MODULES_ROOT];
  for (const root of roots) {
    for (const file of await listFiles(root)) {
      if (inside(path.join(SERVER_ROOT, "tools"), file)) continue;
      const source = await fsp.readFile(file, "utf8");
      if (/\.pi[\\/](settings|pi-flow)\.json/.test(source)) {
        offenders.push(`${path.relative(projectRoot, file)}：读取 .pi 工具配置`);
      }
      for (const specifier of importSpecifiers(source)) {
        if (/(^|[\\/])shard([\\/]|$)/.test(specifier)) {
          offenders.push(`${path.relative(projectRoot, file)} -> ${specifier}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("运行模块和 Electron 不直接读其它领域的状态", async () => {
  const runtime = await fsp.readFile(
    path.join(MODULES_ROOT, "runtime", "server", "index.mjs"),
    "utf8",
  );
  assert.doesNotMatch(runtime, /db\.state\.flows/);

  const main = await fsp.readFile(path.join(ELECTRON_ROOT, "main.mjs"), "utf8");
  assert.doesNotMatch(main, /store\.db\.state\.agents/);
});

test("API 契约没有重复项，动态路由格式正确", async () => {
  const { API_VERSION, ENDPOINTS, endpointKey } = await import("../../server/contract.mjs");
  assert.equal(API_VERSION, 2);
  const keys = ENDPOINTS.map(endpointKey);
  assert.equal(new Set(keys).size, keys.length, "契约里有重复路由");
  for (const entry of ENDPOINTS) {
    assert.ok(entry.method, "缺少 method");
    assert.ok(Boolean(entry.path) !== Boolean(entry.pattern), "path 与 pattern 只能有一个");
  }
});

test("契约端点 id 唯一，动态路由提供可构造的 template", async () => {
  const { ENDPOINTS, endpointKey } = await import("../../server/contract.mjs");
  const ids = ENDPOINTS.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "契约里有重复 id");
  for (const entry of ENDPOINTS) {
    assert.ok(entry.id, `缺少 id：${endpointKey(entry)}`);
    if (!entry.pattern) continue;
    assert.ok(entry.template, `动态路由缺少 template：${endpointKey(entry)}`);
    assert.match(entry.template, /:[A-Za-z0-9_]+/, `template 没有参数：${endpointKey(entry)}`);
  }
});

test("契约请求字段的类型描述合法", async () => {
  const { ENDPOINTS } = await import("../../server/contract.mjs");
  const types = new Set(["string", "number", "boolean", "object", "array"]);
  for (const entry of ENDPOINTS) {
    const fields = { ...(entry.request || {}), ...(entry.query || {}) };
    for (const [name, rule] of Object.entries(fields)) {
      assert.ok(types.has(rule.type), `${entry.id}.${name} 的类型未知：${rule.type}`);
      assert.ok(
        rule.required === undefined || typeof rule.required === "boolean",
        `${entry.id}.${name} 的 required 必须是布尔值`,
      );
    }
  }
});

async function bootHeadless(t, appDirName) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pi-flow-headless-"));
  process.env.PI_FLOW_DATA_DIR = path.join(root, "data");
  process.env.PI_BIN = path.join(projectRoot, "tests", "fixtures", "fake-pi.mjs");

  const { loadState } = await import("../../server/store/index.mjs");
  const { createServer } = await import("../../server/http.mjs");
  await loadState();
  const { server, url } = await createServer({ port: 0, appDir: path.join(root, appDirName) });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsp.rm(root, { recursive: true, force: true });
  });
  return { root, url };
}

test("静态文件探测不用 fs.access（asar 内的目录会被误判为不存在）", async () => {
  const source = await fsp.readFile(path.join(SERVER_ROOT, "http.mjs"), "utf8");
  assert.doesNotMatch(source, /fsp\.access\s*\(/);
});

test("UI 缺失时第二层仍能启动并响应 API", async (t) => {
  const { url } = await bootHeadless(t, "missing-ui");
  assert.equal((await fetch(`${url}/`)).status, 503);
  assert.equal((await fetch(`${url}/api/health`)).status, 200);
  const contract = await (await fetch(`${url}/api/contract`)).json();
  assert.equal(contract.version, 2);
  assert.ok(contract.endpoints.some((entry) => entry.path === "/api/state"));
});

test("换一套 UI 只换 appDir，第二层 API 不变", async (t) => {
  const { root, url } = await bootHeadless(t, "other-ui");
  await fsp.mkdir(path.join(root, "other-ui"), { recursive: true });
  await fsp.writeFile(path.join(root, "other-ui", "index.html"), "<h1>another ui</h1>", "utf8");

  assert.equal(await (await fetch(`${url}/`)).text(), "<h1>another ui</h1>");
  const state = await (await fetch(`${url}/api/state`)).json();
  assert.ok(Array.isArray(state.agents));
  const contract = await (await fetch(`${url}/api/contract`)).json();
  assert.equal(contract.version, 2);
});
