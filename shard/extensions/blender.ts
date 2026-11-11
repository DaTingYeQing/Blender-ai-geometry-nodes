/**
 * blender.ts —— 通往 Blender 的 TS 前端（薄开关）
 *
 * 只做三件事：收参数 → 起 python（blender_channel.py）→ 把输出原样带回。
 * 读档 / 存档 / 执行全在 python 侧，本文件不含任何绝对路径：
 * 地址一律现读上一级的 py_environment.json，可直接进 Git。
 */

import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { envFor, pyEnv, pythonOf, workspaceOf, SKILLS } from "../lib/env.ts";

const CHANNEL = path.join(SKILLS, "execution", "blender_channel.py");

// ===== 收参数 → 起 python → 原样带回 =====
function say(text: string, isError = false) {
	return { content: [{ type: "text", text }], details: { ok: !isError }, isError };
}

function callChannel(args: string[], env: any) {
	const PY = pythonOf(env);
	const WORK = workspaceOf(env);
	const r = spawnSync(PY, [CHANNEL, ...args], {
		encoding: "utf8",
		cwd: WORK,
		timeout: 150_000, // 略高于 channel 内部默认 120s，让它的超时文案先说话
		env: pyEnv(env),
	});
	const stdout = (r.stdout ?? "").trim();
	const stderr = (r.stderr ?? "").trim();
	const out = [stdout, stderr && `[stderr] ${stderr}`].filter(Boolean).join("\n");
	if (r.error) {
		return say(`python 启动失败：${String(r.error)}\n（用的 python：${PY}，来自 py_environment.json）`, true);
	}
	if (r.status !== 0) {
		return say(out || `blender_channel 退出码 ${r.status}（无输出）`, true);
	}
	return say(out);
}

// ===== 工具定义 =====
const blenderRunTool = defineTool({
	name: "blender_run",
	label: "Blender Run",
	description:
		"把一段 Python 代码（expr）或一个脚本文件（script）送进 Blender 后台执行。\n" +
		"自动读 workflow_state.json 里的工作档（Pi Flow 内查当前 flow，终端模式查工作区），跑完存回它（不用传 read/save）。",
	parameters: Type.Object({
		expr: Type.Optional(
			Type.String({
				description: "Python 代码，支持多行/中文。例：import bpy; print(bpy.data.node_groups.keys())",
			}),
		),
		script: Type.Optional(
			Type.String({
				description: "脚本文件路径（与 expr 二选一），相对路径按工作区算，绝对路径也可",
			}),
		),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const env = envFor(ctx.cwd);
		const expr = ((params.expr as string) ?? "").trim();
		const script = ((params.script as string) ?? "").trim();
		if (expr && script) return say("ERROR: expr 和 script 只能给一个", true);
		if (!expr && !script) return say("ERROR: 需要 expr（代码）或 script（脚本文件路径）", true);
		if (expr.length > 20000) return say("ERROR: expr 太长（超过 20000 字符），请改用 script 传脚本文件", true);
		return callChannel(expr ? ["-e", expr] : [script], env);
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(blenderRunTool);
}
