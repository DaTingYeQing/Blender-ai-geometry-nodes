import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { dataDir, statePath } from "../electron/server/store.mjs";

test("数据目录在调用时读取，启动阶段设置也能生效", () => {
  const previous = process.env.PI_FLOW_DATA_DIR;
  const target = path.join(process.env.TEMP || ".", "piflow-store-test");
  process.env.PI_FLOW_DATA_DIR = target;
  try {
    assert.equal(dataDir(), target);
    assert.equal(statePath(), path.join(target, "state.json"));
  } finally {
    if (previous === undefined) delete process.env.PI_FLOW_DATA_DIR;
    else process.env.PI_FLOW_DATA_DIR = previous;
  }
});
