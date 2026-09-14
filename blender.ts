/**
 * blender.ts —— 通往 Blender 的 TS 前端（薄开关）
 *
 * 只做三件事：收参数 → 起 python（blender_channel.py）→ 把输出原样带回。
 * 读档 / 存档 / 执行全在 python 侧，本文件不含任何绝对路径：
 * 地址一律现读上一级的 py_environment.json，可直接进 Git。
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ===== 地址：唯一读 py_environment.json 的地方 =====
const AGENT = path.join(__dirname, ".."); // extensions/ 的上一级 = agent 根
const ENV_JSON = path.join(AGENT, "py_environment.json");

function loadEnv(): any {
	try {
		return JSON.parse(fs.readFileSync(ENV_JSON, "utf8"));
	} catch (e) {
		throw new Error(`读不到地址簿 ${ENV_JSON}（${e}）。它是全部地址的唯一配置处，修好它再启动。`);
	}
}

const ENV = loadEnv();
const PY: string = ENV.python.exe; // 起 python 用（跑在 Blender 外面的那个）
const WORK: string = ENV.workspace.root; // 工作区：python 的启动目录（工作档就在这）
const CHANNEL = path.join(AGENT, "skills", "execution", "blender_channel.py");

// ===== 收参数 → 起 python → 原样带回 =====
function say(text: string, isError = false) {
	return { content: [{ type: "text", text }], details: { ok: !isError }, isError };
}

function callChannel(args: string[]) {
	const r = spawnSync(PY, [CHANNEL, ...args], {
		encoding: "utf8",
		cwd: WORK,
		timeout: 150_000, // 略高于 channel 内部默认 120s，让它的超时文案先说话
		env: { ...process.env, PYTHONIOENCODING: "utf-8" },
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
		"把一段 Python 代码（expr）或一个脚本文件（script）送进 Blender 后台执行，Blender 的输出原样返回（报错不会吞）。expr / script 二选一。\n" +
		"自动读工作区 workflow_state.json 里记的唯一工作档：先打开它再跑，跑完存回它（不用传 read/save）。还没建档会报错——先建档再 run。",
	promptGuidelines: [
		"blender_run 是最后的兜底：只有 blender_data / bpy / zone_probe / blender_screen / blender_build 都取不到你要的数据时，才用它执行任意 Python。",
	],
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
	async execute(_toolCallId, params) {
		const expr = ((params.expr as string) ?? "").trim();
		const script = ((params.script as string) ?? "").trim();
		if (expr && script) return say("ERROR: expr 和 script 只能给一个", true);
		if (!expr && !script) return say("ERROR: 需要 expr（代码）或 script（脚本文件路径）", true);
		if (expr.length > 20000) return say("ERROR: expr 太长（超过 20000 字符），请改用 script 传脚本文件", true);
		return callChannel(expr ? ["-e", expr] : [script]);
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(blenderRunTool);
}
