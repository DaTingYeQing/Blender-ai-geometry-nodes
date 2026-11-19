import assert from "node:assert/strict";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { mergeSeedTree } from "../../electron-ipc/seed.mjs";

const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");

async function tempTree(files) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pf-seed-"));
  for (const [rel, text] of Object.entries(files)) {
    const target = path.join(root, rel.split("/").join(path.sep));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, text);
  }
  return root;
}

const read = (root, rel) => fsp.readFile(path.join(root, rel.split("/").join(path.sep)), "utf8");
const exists = async (root, rel) =>
  fsp.access(path.join(root, rel.split("/").join(path.sep))).then(() => true, () => false);

test("播种合并：新增、更新未改、保留已改、删除未改、跳过生成文件", async () => {
  const template = await tempTree({
    "a/new.txt": "new",
    "a/upd.txt": "template-v2",
    "a/mod.txt": "template-v2",
    "a/same.txt": "same",
    "a/.pi/settings.json": "{}\n",
  });
  const target = await tempTree({
    "a/upd.txt": "template-v1",
    "a/mod.txt": "user edit",
    "a/gone.txt": "gone-v1",
    "a/same.txt": "same",
  });
  const previous = {
    seedVersion: "0.9.0",
    files: {
      "a/upd.txt": sha("template-v1"),
      "a/mod.txt": sha("template-v1"),
      "a/gone.txt": sha("gone-v1"),
      "a/same.txt": sha("same"),
    },
  };

  const { marker, stats } = await mergeSeedTree({
    templateRoot: template,
    targetRoot: target,
    previous,
    seedVersion: "1.0.0",
    filter: (rel) => !rel.endsWith("/.pi/settings.json"),
  });

  assert.equal(await read(target, "a/new.txt"), "new");
  assert.equal(await read(target, "a/upd.txt"), "template-v2");
  assert.equal(await read(target, "a/mod.txt"), "user edit");
  assert.equal(await exists(target, "a/gone.txt"), false);
  assert.equal(await exists(target, "a/.pi/settings.json"), false);

  assert.equal(marker.seedVersion, "1.0.0");
  assert.equal(marker.files["a/new.txt"], sha("new"));
  assert.equal(marker.files["a/upd.txt"], sha("template-v2"));
  // 用户改过的文件：保留旧 base，下次仍能识别"改过"。
  assert.equal(marker.files["a/mod.txt"], sha("template-v1"));
  assert.equal(marker.files["a/gone.txt"], undefined);
  assert.equal(marker.files["a/same.txt"], sha("same"));

  assert.deepEqual(stats, { added: 1, updated: 1, kept: 2, removed: 1, adopted: 0 });
});

test("播种合并：旧清单没有文件指纹时，只认领内容一致的文件", async () => {
  const template = await tempTree({ "a/same.txt": "same", "a/diff.txt": "template-v2", "a/new.txt": "new" });
  const target = await tempTree({ "a/same.txt": "same", "a/diff.txt": "user edit" });

  const { marker, stats } = await mergeSeedTree({
    templateRoot: template,
    targetRoot: target,
    previous: { seedVersion: "0.9.0" },
    seedVersion: "1.0.0",
  });

  assert.equal(await read(target, "a/diff.txt"), "user edit");
  assert.equal(await read(target, "a/new.txt"), "new");
  assert.equal(marker.files["a/same.txt"], sha("same"));
  assert.equal(marker.files["a/diff.txt"], undefined);
  assert.equal(stats.adopted, 1);
});

test("播种合并：用户删掉的模板文件会补回来", async () => {
  const template = await tempTree({ "a/keep.txt": "keep" });
  const target = await tempTree({});
  const { marker } = await mergeSeedTree({
    templateRoot: template,
    targetRoot: target,
    previous: { files: { "a/keep.txt": sha("keep") } },
    seedVersion: "1.0.0",
  });
  assert.equal(await read(target, "a/keep.txt"), "keep");
  assert.equal(marker.files["a/keep.txt"], sha("keep"));
});
