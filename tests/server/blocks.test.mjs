import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importSpecifiers, listFiles, projectRoot } from "../asset-utils.mjs";

process.env.PI_BIN = path.join(projectRoot, "tests", "fixtures", "fake-pi.mjs");

const { createKernel } = await import("../../server/kernel/index.mjs");
const { blocks } = await import("../../server/blocks.mjs");

const SERVER_ROOT = path.join(projectRoot, "server");
const MODULES_ROOT = path.join(projectRoot, "modules");
const BLOCKS_ENTRY = path.join(SERVER_ROOT, "blocks.mjs");

const relative = (file) => path.relative(projectRoot, file).split(path.sep).join("/");

function inside(root, file) {
  const rel = path.relative(root, file);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function blockRoots() {
  const files = [
    ...(await listFiles(SERVER_ROOT)),
    ...(await listFiles(MODULES_ROOT)),
  ].filter((file) => path.basename(file) === "block.mjs");
  return { files, roots: files.map((file) => path.dirname(file)) };
}

test("已登记的块能启动，并暴露声明的方法", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pi-flow-blocks-"));
  process.env.PI_FLOW_DATA_DIR = path.join(root, "data");
  t.after(async () => {
    delete process.env.PI_FLOW_DATA_DIR;
    await fsp.rm(root, { recursive: true, force: true });
  });

  const kernel = createKernel();
  kernel.defineAll(blocks);
  const { apis } = await kernel.boot();

  assert.deepEqual(
    kernel.catalog().map((block) => block.id).sort(),
    ["agents", "artifacts", "flow", "pi", "registry", "runtime", "single", "store", "tools"],
  );
  assert.equal(typeof apis.store.saveState, "function");
  assert.equal(typeof apis.agents.list, "function");
  assert.equal(typeof apis.artifacts.removeWorkspaces, "function");
  assert.equal(typeof apis.flow.get, "function");
  assert.equal(typeof apis.pi.start, "function");
  assert.equal(typeof apis.pi.health, "function");
  assert.equal(typeof apis.runtime.start, "function");
  assert.equal(typeof apis.single.launch, "function");
  assert.equal(typeof apis.single.path, "function");
  assert.equal(typeof apis.tools.resolve, "function");
  assert.equal(typeof apis.tools.catalog, "function");
  assert.equal(typeof apis.registry.loadTemplates, "function");
  assert.equal(typeof apis.registry.loadDevTemplates, "function");
  assert.equal(typeof apis.registry.readPreset, "function");
  assert.equal(typeof apis.registry.seed, "function");
  assert.equal(typeof apis.registry.seedDev, "function");
  assert.equal(typeof apis.registry.singleProject, "function");
});

test("每个 block.mjs 都必须被 server/blocks.mjs 登记", async () => {
  const { files } = await blockRoots();
  const source = await fsp.readFile(BLOCKS_ENTRY, "utf8");
  const registered = new Set(
    importSpecifiers(source)
      .filter((specifier) => specifier.endsWith("block.mjs"))
      .map((specifier) => path.resolve(path.dirname(BLOCKS_ENTRY), specifier)),
  );

  const missing = files.filter((file) => !registered.has(file)).map(relative);
  assert.deepEqual(missing, []);
});

test("http 只通过 blocks 组装，不直接 import 领域模块", async () => {
  const source = await fsp.readFile(path.join(SERVER_ROOT, "http.mjs"), "utf8");
  const offenders = importSpecifiers(source).filter(
    (specifier) =>
      /(^|\/)modules\//.test(specifier) ||
      specifier === "./single.mjs" ||
      specifier === "./single/index.mjs",
  );
  assert.deepEqual(offenders, []);
});

test("块内部不允许 import 另一个块的实现", async () => {
  const { roots } = await blockRoots();
  const allFiles = [
    ...(await listFiles(SERVER_ROOT)),
    ...(await listFiles(MODULES_ROOT)),
  ];
  const offenders = [];

  for (const file of allFiles) {
    if (file === BLOCKS_ENTRY) continue;

    const owner = roots.find((root) => inside(root, file));
    if (!owner) continue;

    const source = await fsp.readFile(file, "utf8");
    for (const specifier of importSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      const resolved = path.resolve(path.dirname(file), specifier);
      const other = roots.find((root) => root !== owner && inside(root, resolved));
      if (other) offenders.push(`${relative(file)} -> ${specifier}`);
    }
  }

  assert.deepEqual(offenders, []);
});
