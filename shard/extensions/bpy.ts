/**
 * bpy 扩展 —— Blender 物体 / 修改器 / 节点的几何探针
 *
 * 只递单子：写 request.json → python -m meshkit.service → 读 result.json。
 * 不执行任意 Python；跑代码用 py 工具。
 * 地址一律现读 py_environment.json；本文件不含任何绝对路径，可直接进 Git。
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { HOME, envFor, pyEnv, pythonOf, workspaceOf } from "../lib/env.ts";

const SERVICE_MODULE = "meshkit.service";

function errRes(text: string, extra?: Record<string, unknown>) {
	return { content: [{ type: "text", text }], details: { ok: false, ...extra }, isError: true };
}
function okRes(text: string, extra?: Record<string, unknown>) {
	return { content: [{ type: "text", text }], details: { ok: true, ...extra } };
}

function str(v: unknown): string {
	return v === undefined || v === null ? "" : String(v).trim();
}

function handleProbe(params: Record<string, unknown>, env: any) {
	const PY = pythonOf(env);
	const WORK = workspaceOf(env);
	const mode = str(params.mode) || "from_blend";
	if (mode !== "from_blend" && mode !== "node_list" && mode !== "export") {
		return errRes("ERROR: mode 必须是 from_blend / node_list / export；跑 Python 用 py 工具");
	}

	const blend = str(params.blend_path);
	const object = str(params.object_name);
	const modifier = str(params.modifier_name);
	if (!blend) return errRes("ERROR: 需要 blend_path（.blend 文件）");
	if (!object) return errRes("ERROR: 需要 object_name（物体名）");
	if (!modifier) return errRes("ERROR: 需要 modifier_name（物体上的几何节点修改器名）");

	// 每次调用独占一套 request/result，避免同工作区并发探测互相覆盖；用完就删。
	const token = `${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
	const requestPath = path.join(WORK, `_bpy_${token}_request.json`);
	const resultPath = path.join(WORK, `_bpy_${token}_result.json`);
	const extra = { mode, blend, object, modifier };
	const request: Record<string, unknown> = {
		op: mode === "export" ? "export_blend" : mode,
		blend,
		object,
		modifier,
		result_path: resultPath,
	};

	if (mode === "from_blend") {
		const node = str(params.node_name);
		if (!node) return errRes("ERROR: mode=from_blend 需要 node_name（从哪个节点取几何）");

		const kind = str(params.summary);
		if (!kind) {
			return errRes("ERROR: 填写你要的数据：summary（第一个空）填 mesh 或 pointcloud，不能空着");
		}
		if (kind !== "mesh" && kind !== "pointcloud") {
			return errRes(`ERROR: summary 只能是 mesh 或 pointcloud，收到 ${JSON.stringify(kind)}`);
		}

		const fields = Array.isArray(params.fields)
			? (params.fields as unknown[]).map(String).filter(Boolean)
			: [];
		if (!fields.length) {
			return errRes('ERROR: 填写你要的数据：fields（第二个空）填你要哪几项，可多个，如 ["bounds","volume"]，不能空着');
		}

		request.node = node;
		request.kind = kind;
		request.fields = fields;

		const rawFrame = str(params.frame);
		if (rawFrame) {
			const frame = Number(rawFrame);
			if (!Number.isFinite(frame)) {
				return errRes(`ERROR: frame 必须是整数，收到 ${JSON.stringify(rawFrame)}`);
			}
			request.frame = Math.trunc(frame);
		}
	}

	if (mode === "export") {
		const node = str(params.node_name);
		if (!node) return errRes("ERROR: mode=export 需要 node_name（导出哪个节点的几何）");
		request.node = node;

		const rawOut = str(params.out_path);
		request.out_path = rawOut
			? (path.isAbsolute(rawOut) ? rawOut : path.resolve(WORK, rawOut))
			: path.join(WORK, "bpy_exports", `${process.pid}_${Date.now().toString(36)}.ply`);

		const rawFrame = str(params.frame);
		if (rawFrame) {
			const frame = Number(rawFrame);
			if (!Number.isFinite(frame)) {
				return errRes(`ERROR: frame 必须是整数，收到 ${JSON.stringify(rawFrame)}`);
			}
			request.frame = Math.trunc(frame);
		}
	}

	try {
		try {
			fs.writeFileSync(requestPath, JSON.stringify(request, null, 2), "utf8");
		} catch (e) {
			return errRes(`写 request 失败：${String((e as Error).message)}`);
		}

		const res = spawnSync(PY, ["-u", "-m", SERVICE_MODULE, requestPath], {
			encoding: "utf8",
			cwd: HOME, // -m 需要从 shard/ 找 meshkit 包
			timeout: 330_000,
			env: pyEnv(env),
		});
		const stdout = (res.stdout ?? "").trim();
		const stderr = (res.stderr ?? "").trim();
		if (res.error) {
			return errRes(
				`python 启动失败：${String(res.error)}\n（用的 python：${PY || "(空)"}，来自 py_environment.json）`,
				extra,
			);
		}

		let result: any = null;
		try {
			result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
		} catch {
			// 由下面的统一报错兜住
		}
		if (!result) {
			return errRes(
				`meshkit 没有产出结果(exit=${res.status ?? "?"})：\n${(stderr || stdout || "(无输出)").slice(0, 1600)}`,
				extra,
			);
		}
		if (result.ok === false) {
			const detail = str(result.error) || stderr || stdout || "(无输出)";
			return errRes(`meshkit 失败：${detail.slice(0, 1600)}`, { ...extra, result });
		}
		if (res.status !== 0) {
			return errRes(
				`meshkit 退出码 ${res.status ?? "?"}：\n${(stderr || stdout || "(无输出)").slice(0, 1600)}`,
				{ ...extra, result },
			);
		}

		if (mode === "node_list") {
			const nodes = Array.isArray(result.nodes) ? result.nodes : [];
			return okRes(JSON.stringify({ nodes }, null, 2), extra);
		}

		if (mode === "export") {
			const files = (result.files ?? {}) as Record<string, string | null>;
			return okRes(JSON.stringify({
				components: result.components ?? [],
				files,
				skipped: result.skipped ?? [],
				hint: "files.mesh 可直接作为 blender_fit 的 target",
			}, null, 2), { ...extra, files });
		}

		const data = {
			status: result.status,
			requested: result.requested,
			available: result.available,
			summary: result.summary,
		};
		return okRes(JSON.stringify(data, null, 2), { ...extra, status: result.status });
	} finally {
		for (const file of [requestPath, resultPath]) {
			try {
				fs.unlinkSync(file);
			} catch {
				// 可能根本没写出来，删不到就算了
			}
		}
	}
}

// ============ 工具定义 ============
const bpyTool = defineTool({
	name: "bpy",
	label: "Bpy",
	description:
		"Blender 几何探针：按「物体 + 几何节点修改器 + 节点」取网格/点云摘要或导出网格。\n" +
		"from_blend：导出指定节点的几何并算 meshkit 字段；export：导出成 PLY（可直接喂给 blender_fit 的 target）；node_list：只列节点清单、不烘几何。\n" +
		"from_blend 时 summary 与 fields 两个空必填：summary 填 mesh / pointcloud，fields 填你要哪几项（可多个）。",
	parameters: Type.Object({
		mode: Type.Union([
			Type.Literal("from_blend"),
			Type.Literal("node_list"),
			Type.Literal("export"),
		], {
			description: "from_blend=导出并取摘要；export=导出 PLY；node_list=只列节点清单",
		}),
		blend_path: Type.String({ description: ".blend 文件路径" }),
		object_name: Type.String({ description: "物体名" }),
		modifier_name: Type.String({ description: "物体上的几何节点修改器名" }),
		node_name: Type.Optional(Type.String({
			description: "mode=from_blend / export：从哪个节点的输出取几何",
		})),
		summary: Type.Optional(Type.Union([
			Type.Literal("mesh"),
			Type.Literal("pointcloud"),
		], {
			description: "mode=from_blend 必填：要 mesh 或 pointcloud",
		})),
		fields: Type.Optional(Type.Array(Type.String(), {
			description: 'mode=from_blend 必填：要哪几项，可多个，如 ["bounds","volume","is_watertight"]',
		})),
		out_path: Type.Optional(Type.String({
			description: "mode=export：PLY 输出路径；不填 = 工作区 bpy_exports/ 下自动命名",
		})),
		frame: Type.Optional(Type.Integer({ description: "取第几帧（可选）" })),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		return handleProbe(params, envFor(ctx.cwd));
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(bpyTool);
}
