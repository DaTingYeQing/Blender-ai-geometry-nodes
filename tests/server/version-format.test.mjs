import assert from "node:assert/strict";
import test from "node:test";

import { normalizeVersion } from "../../shared/versions.mjs";

test("Blender 版本统一成 x.y.z 后再比较", () => {
  assert.equal(normalizeVersion("4.5"), "4.5.0");
  assert.equal(normalizeVersion("4.5.0"), "4.5.0");
  assert.equal(normalizeVersion("4.5.0.1"), "4.5.0");
  assert.equal(normalizeVersion("4.6"), "4.6.0");
  assert.equal(normalizeVersion(""), "");
  assert.equal(normalizeVersion(null), "");
});
