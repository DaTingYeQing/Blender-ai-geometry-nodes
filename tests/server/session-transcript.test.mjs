import assert from "node:assert/strict";
import test from "node:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseSessionText,
  readSessionTranscript,
  sessionDirName,
} from "../../modules/agents/server/session.mjs";
import { makeTempDir } from "../helpers.mjs";

function line(record) {
  return JSON.stringify(record);
}

function message(id, parentId, message) {
  return { type: "message", id, parentId, timestamp: "2026-01-01T00:00:00.000Z", message };
}

test("会话正文：系统提示跳过，工具调用与结果合并成一条", () => {
  const text = [
    line({ type: "session", version: 3, id: "s1", cwd: "C:\\proj", timestamp: "2026-01-01T00:00:00.000Z" }),
    line(message("a", null, { role: "system", content: "", sections: { preamble: "很长" } })),
    line(message("b", "a", { role: "user", content: [{ type: "text", text: "你好 **世界**" }] })),
    line(
      message("c", "b", {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "想一下" },
          { type: "text", text: "**答**" },
          { type: "toolCall", id: "t1", name: "bash", arguments: { command: "ls -la" } },
        ],
      }),
    ),
    line(
      message("d", "c", {
        role: "toolResult",
        toolCallId: "t1",
        toolName: "bash",
        content: [{ type: "text", text: "a.txt" }],
        isError: false,
      }),
    ),
  ].join("\n");

  const result = parseSessionText(text, { id: "s1" });

  assert.deepEqual(
    result.entries.map((entry) => entry.kind),
    ["user", "thinking", "assistant", "tool"],
  );
  assert.match(result.entries[0].html, /<strong>世界<\/strong>/);
  assert.match(result.entries[2].html, /<strong>答<\/strong>/);
  assert.equal(result.entries[3].name, "bash");
  assert.equal(result.entries[3].args, "ls -la");
  assert.equal(result.entries[3].output, "a.txt");
  assert.equal(result.entries[3].state, "done");
  assert.equal(result.session.title, "你好 世界");
  assert.equal(result.session.cwd, "C:\\proj");
  assert.equal(result.session.messageCount, 2);
});

test("会话是树：只还原最后一条所在的分支", () => {
  const text = [
    line({ type: "session", version: 3, id: "s2", cwd: "/p" }),
    line(message("a", null, { role: "user", content: [{ type: "text", text: "起点" }] })),
    line(message("b", "a", { role: "assistant", content: [{ type: "text", text: "主分支" }] })),
    line(message("x", "a", { role: "user", content: [{ type: "text", text: "被丢弃" }] })),
    line(message("c", "b", { role: "assistant", content: [{ type: "text", text: "结尾" }] })),
  ].join("\n");

  const result = parseSessionText(text, { id: "s2" });
  const all = result.entries.map((entry) => entry.text).join("\n");

  assert.match(all, /起点/);
  assert.match(all, /主分支/);
  assert.match(all, /结尾/);
  assert.doesNotMatch(all, /被丢弃/);
});

test("没有 id/parentId 的旧文件按行序读取", () => {
  const text = [
    line({ type: "session", version: 1, id: "s3", cwd: "/p" }),
    line({ type: "message", message: { role: "user", content: "旧问" } }),
    line({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "旧答" }] } }),
  ].join("\n");

  const result = parseSessionText(text, { id: "s3" });
  assert.deepEqual(result.entries.map((entry) => entry.kind), ["user", "assistant"]);
});

test("按 pi 的目录规则能找到会话文件", async (t) => {
  const root = await makeTempDir(t);
  const cwd = path.join(root, "proj");
  const dir = path.join(root, "sessions", sessionDirName(cwd));
  await fsp.mkdir(dir, { recursive: true });

  const id = "01a1da80-49da-73ba-bee7-7c92821141b5";
  await fsp.writeFile(
    path.join(dir, `2026-01-01T00-00-00-000Z_${id}.jsonl`),
    [
      line({ type: "session", version: 3, id, cwd }),
      line(message("a", null, { role: "user", content: [{ type: "text", text: "文件里的问题" }] })),
    ].join("\n"),
  );

  const previous = process.env.PI_CODING_AGENT_SESSION_DIR;
  process.env.PI_CODING_AGENT_SESSION_DIR = path.join(root, "sessions");
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
    else process.env.PI_CODING_AGENT_SESSION_DIR = previous;
  });

  const result = await readSessionTranscript(cwd, id);
  assert.equal(result.missing, false);
  assert.equal(result.session.title, "文件里的问题");
  assert.equal(result.entries.length, 1);

  const absent = await readSessionTranscript(cwd, "nope");
  assert.equal(absent.missing, true);
  assert.deepEqual(absent.entries, []);
});

test("给出 sessionFile 时直接读它，不按 cwd 猜路径", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pi-flow-session-file-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  const file = path.join(root, "custom-session.jsonl");
  const id = "custom-id";
  await fsp.writeFile(
    file,
    [
      line({ type: "session", version: 3, id, cwd: "D:/somewhere/else" }),
      line(message("a", null, { role: "user", content: [{ type: "text", text: "显式文件" }] })),
    ].join("\n"),
  );

  const result = await readSessionTranscript("C:/not/the/session/cwd", id, file);
  assert.equal(result.missing, false);
  assert.equal(result.session.title, "显式文件");
  assert.equal(result.entries.length, 1);
});
