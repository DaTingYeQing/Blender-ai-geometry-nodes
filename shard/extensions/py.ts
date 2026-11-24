/**
 * py 扩展 —— 在 Blender 内置 Python 里执行任意代码
 *
 * 只负责跑代码：起 py_run.py → 目标解释器 → 原样返回 stdout/stderr。
 * 探测 Blender 物体/节点用 bpy；交互预览网格脚本用 mesh_view。
 */

import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { envFor, pyEnv, pythonOf, workspaceOf, SKILLS } from "../lib/env.ts";

const PY_RUN = path.join(SKILLS, "math", "py_run.py");

function errRes(text: string, extra?: Record<string, unknown>) {
	return { content: [{ type: "text", text }], details: { ok: false, ...extra }, isError: true };
}
function okRes(text: string, extra?: Record<string, unknown>) {
	return { content: [{ type: "text", text }], details: { ok: true, ...extra } };
}

function str(v: unknown): string {
	return v === undefined || v === null ? "" : String(v).trim();
}

function handlePy(params: Record<string, unknown>, env: any) {
	const PY = pythonOf(env);
	const WORK = workspaceOf(env);
	const expr = str(params.expr);
	if (!expr) return errRes("ERROR: 需要 expr（Python 代码）");
	if (expr.length > 20000) {
		return errRes("ERROR: expr 太长（超过 20000 字符），请改用脚本文件走 blender_run");
	}

	const res = spawnSync(PY, ["-u", PY_RUN, "--timeout=320", "-e", expr], {
		encoding: "utf8",
		cwd: WORK,
		timeout: 330_000,
		env: pyEnv(env),
	});
	const stdout = (res.stdout ?? "").trim();
	const stderr = (res.stderr ?? "").trim();
	const parts = [stdout];
	if (stderr) parts.push(`[stderr] ${stderr}`);
	if (res.error) {
		return errRes(
			`python 启动失败：${String(res.error)}\n（用的 python：${PY || "(空)"}，来自 py_environment.json）`,
		);
	}
	if (res.status !== 0) {
		return errRes(`python 失败(exit=${res.status ?? "?"}):\n${parts.filter(Boolean).join("\n") || "(无输出)"}`);
	}
	return okRes(parts.filter(Boolean).join("\n"), { stdout });
}

// ============ 工具定义 ============
const pyTool = defineTool({
	name: "py",
	label: "Python",
	description:
		"在 Blender 内置 Python 里跑任意代码（单独进程），能 import meshkit / numpy / scipy / trimesh / pyvista。\n" +
		"注意 import bpy 不可用（bpy 只活在 blender.exe 进程里）；要在 Blender 内跑代码用 blender_run。\n" +
		"探测 Blender 物体/节点用 bpy；交互预览网格脚本用 mesh_view。",
	parameters: Type.Object({
		expr: Type.String({ description: "要执行的 Python 代码" }),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		return handlePy(params, envFor(ctx.cwd));
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(pyTool);
}
