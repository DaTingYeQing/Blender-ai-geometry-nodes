import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { importSpecifiers, listFiles, projectRoot } from "./asset-utils.mjs";

const names = ["agents", "flow", "runtime", "artifacts", "pi"];
const modulesRoot = path.join(projectRoot, "modules");

test("五个模块只从根入口公开服务，并且所有内部入口可加载", async () => {
  for (const name of names) {
    const publicModule = await import(`../modules/${name}/index.mjs`);
    const webEntry = path.join(modulesRoot, name, "web", "index.mjs");
    const hasWeb = await fsp.access(webEntry).then(() => true, () => false);
    assert.deepEqual(Object.keys(publicModule).sort(), hasWeb ? ["createServer", "mount"] : ["createServer"]);
    await import(`../modules/${name}/server/index.mjs`);
    if (hasWeb) await import(`../modules/${name}/web/index.mjs`);
  }

  const packageJson = JSON.parse(await fsp.readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(packageJson.build.files.includes("modules/**/*"));
});

test("相对 import 均有目标，跨模块只允许引用根入口", async () => {
  const files = [
    ...(await listFiles(path.join(projectRoot, "app"))),
    ...(await listFiles(path.join(projectRoot, "electron"))),
    ...(await listFiles(modulesRoot)),
  ];

  for (const file of files) {
    const source = await fsp.readFile(file, "utf8");
    const currentParts = path.relative(modulesRoot, file).split(path.sep);
    const currentModule = names.includes(currentParts[0]) ? currentParts[0] : null;
    if (currentModule) assert.doesNotMatch(source, /\bevents\.(?:on|emit)\(\s*["']/, `${file} 使用了散落的事件名`);
    for (const specifier of importSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      const resolved = path.resolve(path.dirname(file), specifier);
      await assert.doesNotReject(() => fsp.stat(resolved), `${file} 的 import 不存在：${specifier}`);

      const targetParts = path.relative(modulesRoot, resolved).split(path.sep);
      const targetModule = names.includes(targetParts[0]) ? targetParts[0] : null;
      if (!targetModule || targetModule === currentModule) continue;
      assert.equal(
        resolved,
        path.join(modulesRoot, targetModule, "index.mjs"),
        `${file} 跨模块引用了私有文件：${specifier}`,
      );
    }
  }
});

test("画布和检查器只导出工厂，不保留模块级 context", async () => {
  for (const name of ["canvas", "inspector"]) {
    const source = await fsp.readFile(path.join(modulesRoot, "flow/web", `${name}.mjs`), "utf8");
    const exports = [...source.matchAll(/^export function (\w+)/gm)].map((match) => match[1]);
    assert.deepEqual(exports, [name === "canvas" ? "createCanvas" : "createInspector"]);
    assert.doesNotMatch(source, /^(?:let|const) context/m);
  }
});
