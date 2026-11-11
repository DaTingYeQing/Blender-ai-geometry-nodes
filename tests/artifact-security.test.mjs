import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createArtifactsServer } from "../modules/artifacts/server/index.mjs";
import { emptyState, makeStore, makeTempDir } from "./helpers.mjs";

test("符号链接不能越出产物目录", async (t) => {
  const root = await makeTempDir(t);
  const agent = { id: "a", projectPath: path.join(root, "project") };
  const state = emptyState();
  state.agents.push(agent);
  const module = await createArtifactsServer({ store: makeStore(state), agents: { list: () => [agent] } });
  const prepared = await module.api.prepare({ agent, flowId: "flow-a", runId: "run-a" });
  const outside = path.join(root, "secret.txt");
  const link = path.join(prepared.outDir, "linked.txt");
  await fsp.writeFile(outside, "secret", "utf8");

  let linkedFile = link;
  try {
    await fsp.symlink(outside, link, "file");
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOSYS"].includes(error.code)) throw error;
    try {
      const outsideDir = path.join(root, "outside");
      const linkedDir = path.join(prepared.outDir, "linked-dir");
      await fsp.mkdir(outsideDir);
      await fsp.writeFile(path.join(outsideDir, "secret.txt"), "secret", "utf8");
      await fsp.symlink(outsideDir, linkedDir, "junction");
      linkedFile = path.join(linkedDir, "secret.txt");
    } catch (junctionError) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(junctionError.code)) {
        t.skip("当前系统不允许创建符号链接或 junction");
        return;
      }
      throw junctionError;
    }
  }

  await assert.rejects(() => module.api.read(linkedFile), /路径不允许/);
  const downstream = await module.api.prepare({
    agent,
    flowId: "flow-b",
    runId: "run-b",
    inputFiles: [{ name: "linked.txt", path: linkedFile }],
  });
  assert.equal(downstream.inputs.length, 0);
  assert.deepEqual(await module.api.collect(prepared.outDir), []);
});
