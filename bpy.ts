/**
 * bpy 扩展 —— 往外部 python环境执行 Python 代码，拿几何摘要 / 任意网格分析
 *
 * 薄前端：收参数 → 起 bpy_run.py（它自己把代码交给对的 python、把 meshkit 路径摆好）→ 原样返回。
 * 地址一律现读上一级的 py_environment.json；本文件不含任何绝对路径，可直接进 Git。
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
const WORK: string = ENV.workspace.root; // 工作区：python 的启动目录
const BPY_RUN = path.join(AGENT, "skills", "math", "bpy_run.py"); // 目标解释器 / meshkit 路径它自理

function errRes(text: string, extra?: Record<string, unknown>) {
	return { content: [{ type: "text", text }], details: { ok: false, ...extra }, isError: true };
}
function okRes(text: string, extra?: Record<string, unknown>) {
	return { content: [{ type: "text", text }], details: { ok: true, ...extra } };
}

function handleRun(params: Record<string, unknown>) {
	const expr = ((params.expr as string) ?? "").trim();
	if (!expr) return errRes("ERROR: 需要 expr（Python 代码）");
	if (expr.length > 20000) return errRes("ERROR: expr 太长（超过 20000 字符），请改用脚本文件走 blender_run");

	// -e 传代码：spawnSync 用 args 数组，不经 shell，引号/换行安全
	// -u：关掉 python 的块缓冲。否则走管道时 stdout 会攒着，
	// 一旦脚本抛异常退出就会丢掉前面所有 print（诊断信息全没了）。
	const res = spawnSync(PY, ["-u", BPY_RUN, "-e", expr], {
		encoding: "utf8",
		cwd: WORK,
		timeout: 240_000, // 略高于 bpy_run 内部默认 180s，让它的超时文案先说话
		env: {
			...process.env,
			PYTHONIOENCODING: "utf-8",
		},
	});
	const stdout = (res.stdout ?? "").trim();
	const stderr = (res.stderr ?? "").trim();
	const parts = [stdout];
	if (stderr) parts.push(`[stderr] ${stderr}`);
	if (res.error) {
		return errRes(`python 启动失败：${String(res.error)}\n（用的 python：${PY}，来自 py_environment.json）`);
	}
	if (res.status !== 0) {
		return errRes(`python 失败(exit=${res.status ?? "?"}):\n${parts.filter(Boolean).join("\n") || String(res.error || "")}`);
	}
	return okRes(parts.filter(Boolean).join("\n"), { stdout });
}

// ============ 工具定义 ============
const bpyTool = defineTool({
	name: "bpy",
	label: "Bpy",
	description:
		"往 meshkit 环境（venv13）执行 Python 代码。expr 必填，stdout 与 [stderr] 原样返回；可直接 import meshkit / numpy / trimesh / pyvista。\n" +
		"meshkit 现成函数（返回 dict，字段名见返回值或 skills/math/meshkit.py 源码）：\n" +
		"- mesh_summary(mesh)：网格摘要 32 项 —— 计数 / 包围盒 / 体积面积 / 惯性 / 拓扑(watertight、euler、body_count…) / manifold 体检 / 凸包·OBB·外接球\n" +
		"- pointcloud_summary(pc)：点云摘要 10 项 —— n_points / bounds / centroid / 主轴 / std / 凸包 / OBB / 外接球\n" +
		"- summarize_from_blender(blend, object, modifier, node, summary, frame=None)：一步从 .blend 拿上述摘要（无头 10-30s）。\n" +
		"    summary 用 out(\"mesh\") / out(\"pointcloud\") 指定，不写=全部；node 传 LIST 只列节点清单；\n" +
		"    frame=N 取第 N 帧（模拟区/ForEach 从第 1 帧逐帧推进，跳帧拿到的是第 1 帧）；不填=当前帧；\n" +
		"    实例几何会在组输出前自动 Realize Instances，不需要 apply 修改器（走 depsgraph，不改档）。\n" +
		"- load_mesh(path)：读 PLY/GLB/OBJ/STL，再喂给上面两个 summary。",
	promptGuidelines: [
		"静态几何（给 .blend 求值后取网格/点云摘要）首选 bpy，不要绕道 blender_data。",
	],
	parameters: Type.Object({
		expr: Type.String({
			description:
				"Python 代码，多行/中文均可。典型：import meshkit; r=meshkit.summarize_from_blender(r'C:/.../x.blend','物体','修改器','节点',summary='... out(pointcloud)'); print(r)",
		}),
	}),
	async execute(_toolCallId, params) {
		return handleRun(params);
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(bpyTool);
}
