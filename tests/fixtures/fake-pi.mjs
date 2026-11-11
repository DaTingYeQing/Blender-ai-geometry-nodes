import fsp from "node:fs/promises";
import path from "node:path";

let buffer = "";

function send(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

async function findOutputDir() {
  const flowRoot = path.join(process.cwd(), ".pi", "flow");
  const outputs = [];

  async function walk(dir, depth) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.name === "output") {
        const stat = await fsp.stat(abs);
        outputs.push({ dir: abs, mtime: stat.mtimeMs });
        continue;
      }
      if (depth > 0) await walk(abs, depth - 1);
    }
  }

  await walk(flowRoot, 4);
  outputs.sort((a, b) => b.mtime - a.mtime);
  return outputs[0]?.dir || null;
}

async function handle(record) {
  if (record.type === "prompt") {
    const outDir = await findOutputDir();
    if (outDir) {
      await fsp.mkdir(outDir, { recursive: true });
      await fsp.writeFile(path.join(outDir, "result.txt"), "fake pi artifact", "utf8");
    }
    send({ id: record.id, type: "response", command: "prompt", success: true, data: { disposition: "started" } });
    return;
  }

  if (record.type === "get_state") {
    send({ id: record.id, type: "response", command: "get_state", success: true, data: { sessionId: "pi-test-session" } });
    send({ type: "tool_execution_start", toolName: "write", args: { path: "result.txt" } });
    send({ type: "tool_execution_end", toolName: "write", isError: false, durationMs: 1 });
    send({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "先想一下" } });
    send({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "完成" } });
    send({ type: "agent_settled", aborted: false });
  }
}

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (line.trim()) void handle(JSON.parse(line));
  }
});
