/**
 * Pi Flow「call」工具
 *
 * 作用：把一段内容写入当前这次 run 的 output 目录，使下游节点可以把它当作输入文件。
 * 模型只需要传 content；默认文件名固定为 call.md，便于连线勾选在多次运行之间保持有效。
 *
 * 安装方式（三选一）：
 *   1. 复制到 ~/.pi/agent/extensions/call.ts（全局）
 *   2. 复制到 <项目>/.pi/extensions/call.ts（项目级，项目需已被 pi 信任）
 *   3. 在 .pi/settings.json 的 extensions 数组里加入本文件路径
 *
 * 如果工具没有出现在可用列表中，在 .pi/settings.json 里把 call 加入工具：
 *   "defaultTools": ["read", "bash", "edit", "write", "+call"]
 *
 * 依赖 pi-flow 在启动时注入环境变量：
 *   PI_FLOW_OUTPUT_DIR（必需）、PI_FLOW_FLOW_ID、PI_FLOW_RUN_ID、PI_FLOW_RUN_DIR、PI_FLOW_INPUT_DIR
 */
import { defineTool, withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const callTool = defineTool({
  name: "call",
  label: "Call",
  description:
    "当你需要把内容交给下一个代理、而不是在聊天中回复时，请使用 call。call 会写入当前运行的输出目录；下游节点会将其作为输入文件读取。",
  parameters: Type.Object({
    content: Type.String({ description: "要发送给下游的完整内容" }),
    name: Type.Optional(Type.String({ description: "可选文件名（不含路径），默认 call.md" })),
  }),
  async execute(_toolCallId, params) {
    const outDir = process.env.PI_FLOW_OUTPUT_DIR;
    if (!outDir) {
      throw new Error("PI_FLOW_OUTPUT_DIR 未设置：call 只能在 Pi Flow 节点运行中使用");
    }

    const base = basename(String(params.name || "call")).replace(/[\\/:*?"<>|]/g, "-") || "call";
    const filename = base.toLowerCase().endsWith(".md") ? base : `${base}.md`;
    const target = resolve(join(outDir, filename));
    if (dirname(target) !== resolve(outDir)) {
      throw new Error(`非法文件名：${filename}`);
    }

    await withFileMutationQueue(target, async () => {
      await mkdir(outDir, { recursive: true });
      await writeFile(target, params.content, "utf8");
    });

    return {
      content: [{ type: "text", text: `已发送：${filename}` }],
      details: {
        flowId: process.env.PI_FLOW_FLOW_ID ?? null,
        runId: process.env.PI_FLOW_RUN_ID ?? null,
        name: filename,
        path: target,
        size: Buffer.byteLength(params.content, "utf8"),
      },
    };
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(callTool);
}
