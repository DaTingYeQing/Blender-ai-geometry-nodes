/**
 * mesh_probe 扩展 —— 网格脚本的分段探针
 *
 * 导入一份按 STAGES + build(**params, stage=None) 写成的脚本，从原料开始
 * 累计跑到每一段结束，用 meshkit 导出该段几何数据：
 *   <工作区>/<脚本名>/stage1.json、stage2.json……
 *
 * 前端只负责：解析脚本路径和参数 → 递 stage 单子 → 读短摘要。
 * 完整数据在 stage*.json 里，不塞进上下文。
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

function resolveScript(raw: unknown, cwd: string, work: string): string | { err: string } {
	const text = str(raw);
	if (!text) return { err: "ERROR: 需要 script（要测试的 .py 路径）" };
	const candidates = path.isAbsolute(text)
		? [text]
		: [path.resolve(cwd, text), path.resolve(work, text)];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
	}
	return { err: `ERROR: 找不到脚本 ${text}\n试过：\n${candidates.join("\n")}` };
}

type ParamsResult =
	| { ok: true; value: Record<string, unknown> }
	| { ok: false; err: string };

function readParams(value: unknown): ParamsResult {
	if (value === undefined || value === null || value === "") return { ok: true, value: {} };
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return { ok: true, value: parsed as Record<string, unknown> };
			}
		} catch {
			// 落到下面的统一报错
		}
		return { ok: false, err: 'ERROR: params 要写成 JSON 对象，如 {"n":24,"eps":0.003,"t":1.0}' };
	}
	if (typeof value === "object" && !Array.isArray(value)) {
		return { ok: true, value: value as Record<string, unknown> };
	}
	return { ok: false, err: 'ERROR: params 要写成对象，如 {"n":24,"eps":0.003,"t":1.0}；数组值直接写 [1,2,3]' };
}

function folderName(stem: string): string {
	return stem.replace(/[\\/:*?"<>|]/g, "_").trim() || "mesh";
}

function fmt(v: unknown): string {
	if (typeof v === "number") {
		if (!Number.isFinite(v)) return String(v);
		const abs = Math.abs(v);
		if (abs !== 0 && (abs < 1e-3 || abs >= 1e5)) return v.toExponential(3);
		return String(Math.round(v * 1e6) / 1e6);
	}
	if (Array.isArray(v)) return "[" + v.map(fmt).join(", ") + "]";
	return v === undefined || v === null ? "—" : String(v);
}

function stageLine(record: any): string {
	const index = record?.index ?? "?";
	const name = record?.name ?? "?";
	const kind = record?.kind ?? "?";
	const s = record?.preview ?? {};
	if (kind === "pointcloud") {
		return `  stage${index} ${name}: pointcloud ${s.n_points ?? "?"} 点，extents ${fmt(s.extents)}`;
	}
	const pieces = s.n_pieces !== undefined && s.n_pieces !== null ? `${s.n_pieces} 块，` : "";
	const watertight = s.is_watertight === undefined ? "" : `，水密 ${s.is_watertight ? "是" : "否"}`;
	return `  stage${index} ${name}: ${kind} ${pieces}合并 ${s.n_vertices ?? "?"} 顶点 / ${s.n_faces ?? "?"} 面，volume ${fmt(s.volume)}，area ${fmt(s.area)}${watertight}`;
}

function handleProbe(params: Record<string, unknown>, env: any, cwd: string) {
	const PY = pythonOf(env);
	const WORK = workspaceOf(env);
	const found = resolveScript(params.script, cwd, WORK);
	if (typeof found !== "string") return errRes(found.err);
	const script = found;

	const parsed = readParams(params.params);
	if (!parsed.ok) return errRes(parsed.err);

	const stem = path.basename(script, path.extname(script));
	const rawOut = str(params.out_dir);
	const outDir = rawOut
		? (path.isAbsolute(rawOut) ? rawOut : path.resolve(WORK, rawOut))
		: path.join(WORK, folderName(stem));

	const requestPath = path.join(WORK, "_mesh_probe_request.json");
	const resultPath = path.join(WORK, "_mesh_probe_result.json");
	try {
		fs.unlinkSync(resultPath);
	} catch {
		// 没有旧结果就是最好
	}
	try {
		fs.writeFileSync(
			requestPath,
			JSON.stringify({
				op: "stage",
				script,
				params: parsed.value,
				out_dir: outDir,
				result_path: resultPath,
			}, null, 2),
			"utf8",
		);
	} catch (e) {
		return errRes(`写 request 失败：${String((e as Error).message)}`);
	}

	const res = spawnSync(PY, ["-u", "-m", SERVICE_MODULE, requestPath], {
		encoding: "utf8",
		cwd: HOME, // -m 需要从 shard/ 找 meshkit 包
		timeout: 300_000,
		env: pyEnv(env),
	});
	const stdout = (res.stdout ?? "").trim();
	const stderr = (res.stderr ?? "").trim();
	const extra = { script, out_dir: outDir, request: requestPath };

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

	const stages = Array.isArray(result.stages) ? result.stages : [];
	const files = stages.map((row: any) => row.file).filter(Boolean);
	const lines = [
		`[mesh_probe] ${result.script_name}：${stages.length} 段，参数 ${JSON.stringify(result.params)}`,
		...stages.map(stageLine),
		`  落盘：${outDir}`,
		`  文件：${files.join("、")}`,
		"  （完整 meshkit 数据在各 stage*.json 里，需要再加 read 读）",
	];
	return okRes(lines.join("\n"), {
		...extra,
		result,
		stage_files: files,
	});
}

// ============ 工具定义 ============
const meshProbeTool = defineTool({
	name: "mesh_probe",
	label: "Mesh Probe",
	description:
		"网格脚本分段探针：导入脚本，按 STAGES 从原料累计跑到每一段结束，用 meshkit 导出该段几何数据。\n" +
		"params 直接给具体值（数字 / 布尔 / 数组），可同时设多个变量，如 {\"n\":24,\"eps\":0.003,\"t\":1.0}。\n" +
		"脚本要求：模块级 STAGES + build(**params, stage=None)；stage=k 表示累计跑到第 k 段（不是单独跑第 k 段）。\n" +
		"每段写一份 <工作区>/<脚本名>/stage1.json、stage2.json……；返回只给摘要和路径，完整数据在文件里。",
	parameters: Type.Object({
		script: Type.String({ description: "要测试的 .py 路径（绝对路径，或相对当前目录/工作区）" }),
		params: Type.Optional(Type.Any({
			description: 'SCHEMA 参数的具体值，如 {"n":24,"eps":0.003,"t":1.0}；数组值直接写 [1,2,3]。不填用 SCHEMA 默认值。',
		})),
		out_dir: Type.Optional(Type.String({
			description: "导出文件夹；默认 <工作区>/<脚本名>",
		})),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		return handleProbe(params, envFor(ctx.cwd), ctx.cwd);
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(meshProbeTool);
}
