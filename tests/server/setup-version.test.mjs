import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fsp.readFile(path.join(projectRoot, relative), "utf8");

test("分层版本清单和 setup-result 字段一致", async () => {
  const versions = JSON.parse(await read("shard/versions.json"));
  assert.equal(versions.runtimeLayout, "1.0.0");
  assert.equal(versions.covtraceVersion, "1.0.0");
  assert.equal(versions.configVersion, "1.0.0");
  assert.equal(versions.seedVersion, "1.0.0");
  assert.equal(versions.dataSchemaVersion, "1.0.0");

  const engine = await read("scripts/setup/engine.ps1");
  assert.match(engine, /versions\.json/);
  assert.match(engine, /appVersion\s+=\s+\$setup\.AppVersion/);
  assert.match(engine, /blenderVersion\s+=\s+\$setup\.BlenderVersion/);
  assert.match(engine, /runtimeLayout\s+=\s+\$setup\.RuntimeLayout/);
  assert.match(engine, /covtraceVersion\s+=\s+\$setup\.CovtraceVersion/);
  assert.match(engine, /configVersion\s+=\s+\$setup\.ConfigVersion/);
  assert.match(engine, /seedVersion\s+=\s+\$setup\.SeedVersion/);
  assert.match(engine, /dataSchemaVersion\s+=\s+\$setup\.DataSchemaVersion/);
  // Blender 版本从内置压缩包文件名取，换包自动跟着变。
  assert.match(engine, /blender-\(\[\\d\.\]\+\)/);

  const entry = await read("scripts/setup-runtime.ps1");
  assert.match(entry, /\[string\]\$AppVersion/);
  assert.match(entry, /AppVersion\s+=\s+\$AppVersion/);

  const runtime = await read("electron-ipc/runtime.mjs");
  assert.match(runtime, /"-AppVersion"/);
  assert.match(runtime, /app\.getVersion\(\)/);
  assert.match(runtime, /seedVersion/);
});

test("升级对账：版本差异只重建变化的层", async () => {
  const runtime = await read("electron-ipc/runtime.mjs");
  assert.match(runtime, /runtimeVersionMismatches/);
  assert.match(runtime, /moveAsideRuntime/);
  assert.match(runtime, /forceBlender/);
  assert.match(runtime, /covtraceVersion/);
  assert.match(runtime, /"legacy"/);

  const main = await read("electron-ipc/main.mjs");
  assert.match(main, /runtimeVersionMismatches/);

  const entry = await read("scripts/setup-runtime.ps1");
  assert.match(entry, /\[switch\]\$ForceBlender/);
  assert.match(entry, /ForceBlender\s+=\s+\[bool\]\$ForceBlender/);

  const engine = await read("scripts/setup/engine.ps1");
  assert.match(engine, /ForceBlender\s+=\s+\[bool\]\$Options\.ForceBlender/);

  const blender = await read("scripts/setup/cards/40-blender.ps1");
  assert.match(blender, /ForceBlender/);

  const covtrace = await read("scripts/setup/cards/45-covtrace.ps1");
  assert.match(covtrace, /CovtraceVersionFile/);
  assert.match(covtrace, /Clear-CovtraceDirs/);
});

test("配置和数据各记自己的版本", async () => {
  const config = await read("scripts/setup/cards/60-config.ps1");
  assert.match(config, /configVersion/);
  // 配置是字段级三方合并，不是整份覆盖。
  assert.match(config, /\.pi-flow-generated\.json/);
  assert.match(config, /Copy-MissingTemplateKeys/);
  assert.match(config, /hadConfig/);

  const store = await read("server/store/index.mjs");
  assert.match(store, /dataSchemaVersion/);
  assert.match(store, /schemaVersion/);

  const installer = await read("scripts/installer/installer.nsh");
  assert.match(installer, /\$\{ifNot\}\s+\$\{isUpdated\}/);
});
