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

/** 取字符串字段（去空白）；给过但为空 → 视为没给。 */
function str(v: unknown): string {
	return v === undefined || v === null ? "" : String(v).trim();
}
/** Python 字符串字面量。JSON.stringify 的转义规则与 Python 双引号串一致，含中文/反斜杠均安全。 */
function pyStr(v: string): string {
	return JSON.stringify(v);
}

/**
 * 把「填好的单子」拼成一段 Python 代码（keyword 传参，位置不可能写错）。
 * 返回代码串，或 { err }。mode=code 不走这里。
 */
function buildExpr(params: Record<string, unknown>): string | { err: string } {
	const mode = str(params.mode) || "code";
	const need = (label: string, v: string): string | { err: string } =>
		v ? v : { err: `ERROR: mode=${mode} 需要 ${label}` };

	// ---- mode=node_list：只看树里有哪些节点，不烘几何 ----
	// 单独拎出来是因为后端要求 node_name="LIST" 且 summary 必须非空——
	// 那个「随便填个非空值」是个纯粹的抄写陷阱，这里替 AI 填掉。
	if (mode === "node_list") {
		const b = need("blend_path", str(params.blend_path));
		if (typeof b !== "string") return b;
		const o = need("object_name", str(params.object_name));
		if (typeof o !== "string") return o;
		const m = need("modifier_name", str(params.modifier_name));
		if (typeof m !== "string") return m;
		return (
			"import meshkit, json\n" +
			`r = meshkit.summarize_from_blender(blend_path=${pyStr(b)}, object_name=${pyStr(o)}, ` +
			`modifier_name=${pyStr(m)}, node_name="LIST", summary="list")\n` +
			"print(json.dumps(r, ensure_ascii=False, indent=2))"
		);
	}

	// ---- mode=from_blend：从 .blend 一步拿摘要 ----
	if (mode === "from_blend") {
		const b = need("blend_path", str(params.blend_path));
		if (typeof b !== "string") return b;
		const o = need("object_name", str(params.object_name));
		if (typeof o !== "string") return o;
		const m = need("modifier_name", str(params.modifier_name));
		if (typeof m !== "string") return m;
		const n = need("node_name", str(params.node_name));
		if (typeof n !== "string") return n;
		// summary / fields 两个空必填：空着直接报错（不给默认全量，避免刷爆上下文）
		const extra: string[] = [];
		const sm = str(params.summary);
		if (!sm) {
			return { err: "ERROR: 填写你要的数据：summary（第一个空）填 mesh 或 pointcloud，不能空着" };
		}
		const flds = Array.isArray(params.fields)
			? (params.fields as unknown[]).map(String).filter(Boolean)
			: [];
		if (!flds.length) {
			return { err: 'ERROR: 填写你要的数据：fields（第二个空）填你要哪几项，可多个，如 ["bounds","volume"]，不能空着' };
		}
		// 后端 meshkit 只认 out("xxx") 记法：这里替 AI 包好，AI 侧只填 mesh / pointcloud
		extra.push(`summary=${pyStr(`out("${sm}")`)}`);
		extra.push(`fields=[${flds.map(pyStr).join(", ")}]`);
		const fr = str(params.frame);
		if (fr) {
			const num = Number(fr);
			if (!Number.isFinite(num)) return { err: `ERROR: frame 必须是整数，收到 ${pyStr(fr)}` };
			extra.push(`frame=${Math.trunc(num)}`);
		}
		return (
			"import meshkit, json\n" +
			`r = meshkit.summarize_from_blender(blend_path=${pyStr(b)}, object_name=${pyStr(o)}, ` +
			`modifier_name=${pyStr(m)}, node_name=${pyStr(n)}${extra.length ? ", " + extra.join(", ") : ""})\n` +
			"print(json.dumps(r, ensure_ascii=False, indent=2))"
		);
	}

	// ---- mode=code：白纸，调用方另行处理 expr ----
	if (mode !== "code") {
		return { err: `ERROR: mode 必须是 from_blend / node_list / code，收到 ${pyStr(mode)}` };
	}
	return "";
}

function handleRun(params: Record<string, unknown>) {
	const mode = str(params.mode) || "code";
	let expr: string;

	if (mode === "code") {
		expr = str(params.expr);
		if (!expr) return errRes("ERROR: mode=code 需要 expr（Python 代码）");
	} else {
		const built = buildExpr(params);
		if (typeof built !== "string") return errRes(built.err);
		if (!built) return errRes(`ERROR: 未知 mode ${pyStr(mode)}`);
		expr = built;
	}
	if (expr.length > 20000) return errRes("ERROR: expr 太长（超过 20000 字符），请改用脚本文件走 blender_run");

	// -e 传代码：spawnSync 用 args 数组，不经 shell，引号/换行安全
	// -u：关掉 python 的块缓冲。否则走管道时 stdout 会攒着，
	// 一旦脚本抛异常退出就会丢掉前面所有 print（诊断信息全没了）。
	const res = spawnSync(PY, ["-u", BPY_RUN, "--timeout=320", "-e", expr], {
		encoding: "utf8",
		cwd: WORK,
		// 超时链（从外到内）：本层 330s > 传给 bpy_run 的 320s > meshkit 开 Blender 300s。
		// meshkit 给自己留了 300s，并备好「场景过大或 Blender 卡住」的文案；
		// 必须显式把 --timeout 传下去——bpy_run 自己的默认只有 180s，
		// 不覆盖的话它会在第 180 秒先杀，那 300s 的解释永远说不出口。
		timeout: 330_000,
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
	return okRes(parts.filter(Boolean).join("\n"), { stdout, mode });
}

// ============ 工具定义 ============
const bpyTool = defineTool({
	name: "bpy",
	label: "Bpy",
	description:
		"网格分析。三种用法由 mode 选，选完只填那个 mode 需要的字段。\n" +
		"from_blend：从 .blend 按「物体 + 修改器 + 节点」一步取摘要（无头开 Blender，10-30s）；实例几何引擎会自动 Realize Instances，不修改器 apply 。" +
		"【summary 与 fields 两个空必填】：summary 填 mesh / pointcloud，fields 填你要哪几项（可多个）。返回只含你要的项。\n" +
		"node_list：同上但只列节点清单、不烘几何 —— 不知道树里有哪些节点、哪个带几何输出时先用它探。\n" +
		"code：写任意 Python —— 跑在外部 python里，能 import meshkit / numpy / trimesh / pyvista，没有 bpy；要在 Blender 内跑代码用 blender_run。\n" +
		"摘要内容：网格 32 项。；" +
		"点云 10 项。",
	parameters: Type.Object({
		mode: Type.Union([
			Type.Literal("from_blend"),
			Type.Literal("node_list"),
			Type.Literal("code"),
		], {
			description: "from_blend=从 .blend 取摘要；node_list=只列节点清单；code=自由写 Python",
		}),
		blend_path: Type.Optional(Type.String({
			description: "mode=from_blend / node_list：.blend 文件路径",
		})),
		object_name: Type.Optional(Type.String({
			description: "mode=from_blend / node_list：物体名",
		})),
		modifier_name: Type.Optional(Type.String({
			description: "mode=from_blend / node_list：几何节点修改器名",
		})),
		node_name: Type.Optional(Type.String({
			description: "mode=from_blend：几何节点名 —— 指定从哪个节点的输出取几何（node_list 不用填）",
		})),
		summary: Type.Optional(Type.Union([
			Type.Literal("mesh"),
			Type.Literal("pointcloud"),
		], {
			description: "mode=from_blend 必填：要mesh 或 pointcloud。",
		})),
		fields: Type.Optional(Type.Array(Type.String(), {
			description: "mode=from_blend 必填：可一次给多个，如 [\"bounds\",\"volume\",\"is_watertight\"]。"
				+ "mesh 32 项：n_vertices/n_faces/n_edges/bounds/extents/volume/area/center_mass/moment_inertia/"
				+ "principal_inertia_components/principal_inertia_vectors/euler_number/is_watertight/is_winding_consistent/"
				+ "is_volume/body_count/hull/obb_extents/bounding_sphere/bounding_cylinder/units/metadata/n_open_edges/"
				+ "center_of_mass/bbox_center/bbox_diagonal/array_names/n_connected_components/manifold_status/"
				+ "manifold_verts/manifold_tris/genus；"
				+ "pointcloud 10 项：n_points/bounds/extents/centroid/axis_mean/axis_std/scale/hull/obb_extents/bounding_sphere。"
		})),
		frame: Type.Optional(Type.Integer({
			description: "mode=from_blend：取第几帧。不填=场景当前帧。模拟区有状态，引擎会从第 1 帧推到这",
		})),
		expr: Type.Optional(Type.String({
			description: "mode=code：Python 代码，多行/中文均可（外部 python，无 bpy）。其它 mode 不用填",
		})),
	}),
	async execute(_toolCallId, params) {
		return handleRun(params);
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(bpyTool);
}
