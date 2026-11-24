/**
 * blender_fit 扩展 —— 黑盒拟合：填参数单子 → Optuna 搜索 → 报告落盘
 *
 * 前端只做三件事：把表单拼成 fit.json、起 fitting.engine、从报告里抽一句摘要。
 * 完整 trial、最优参数、每轮 PLY 都在文件里，不塞进上下文。
 *
 * 单次运行：每次都是全新的 in-memory study，不读写 Optuna journal；
 * 只有「目标 / 场景 / 搜索空间 / 打分计划」完全一致时，才用 run_dir/seed.json
 * 里上次的最优参数热启动前几个 trial。
 *
 * 场景前提：object 上已有几何节点修改器（没有就先用 blender_build 的 bind），
 * 输入口必须未连线；顶层 node 是导出几何的那个节点，inputs 每项可指定别的节点。
 * 地址一律现读 py_environment.json；本文件不含任何绝对路径，可直接进 Git。
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { envFor, pyEnv, pythonOf, workspaceOf, SKILLS } from "../lib/env.ts";

const SHARD = path.join(SKILLS, ".."); // python -m fitting.engine 的工作目录

function errRes(text: string, extra?: Record<string, unknown>) {
	return { content: [{ type: "text", text }], details: { ok: false, ...extra }, isError: true };
}
function okRes(text: string, extra?: Record<string, unknown>) {
	return { content: [{ type: "text", text }], details: { ok: true, ...extra } };
}

function str(v: unknown): string {
	return v === undefined || v === null ? "" : String(v).trim();
}
function num(v: unknown): number | undefined {
	if (v === undefined || v === null || v === "") return undefined;
	const n = Number(v);
	return Number.isFinite(n) ? n : undefined;
}
function int(v: unknown): number | undefined {
	const n = num(v);
	return n === undefined ? undefined : Math.trunc(n);
}
function resolveEnvPath(value: unknown, baseDir?: string): string {
	const text = str(value);
	if (!text) return "";
	return path.isAbsolute(text) ? text : path.resolve(baseDir || "", text);
}

/** 没给 blend 时，从工作区/当前 flow 的 workflow_state.json 里取工作档。 */
function blendFromState(work: string): string {
	const dirs = [
		work,
		process.env.PI_FLOW_INPUT_DIR,
		process.env.PI_FLOW_OUTPUT_DIR,
	].filter(Boolean) as string[];
	for (const dir of dirs) {
		const file = path.join(dir, "workflow_state.json");
		if (!fs.existsSync(file)) continue;
		try {
			const data = JSON.parse(fs.readFileSync(file, "utf8"));
			const blend = str(data?.blend);
			if (blend) return blend;
		} catch {
			// 坏 state 继续找下一处
		}
	}
	return "";
}

type ParamsResult =
	| { ok: true; value: Record<string, unknown> }
	| { ok: false; err: string };

/** params：对象或 JSON 字符串；不填 = 用脚本 SCHEMA 的默认值。 */
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
		return { ok: false, err: 'ERROR: params 要写成 JSON 对象，如 {"n":24,"eps":0.003}' };
	}
	if (typeof value === "object" && !Array.isArray(value)) {
		return { ok: true, value: value as Record<string, unknown> };
	}
	return { ok: false, err: 'ERROR: params 要写成对象，如 {"n":24,"eps":0.003}' };
}

function buildConfig(params: Record<string, unknown>, work: string, cwd: string): Record<string, unknown> | { err: string } {
	const object = str(params.object);
	const modifier = str(params.modifier);
	const node = str(params.node);
	if (!object) return { err: "ERROR: 需要 object（物体 name）" };
	if (!modifier) return { err: "ERROR: 需要 modifier（物体上的几何节点修改器名；没有就先用 blender_build 的 bind 建）" };
	if (!node) return { err: "ERROR: 需要 node（从哪个节点导出几何，也是 inputs 的默认节点）" };

	const blend = str(params.blend) || blendFromState(work);
	if (!blend) {
		return {
			err: "ERROR: 没给 blend，也没找到 workflow_state.json。"
				+ "先 wf_plan 建档 / 手放 workflow_state.json，或直接传 blend=<档路径>",
		};
	}
	const blendPath = path.isAbsolute(blend) ? blend : path.resolve(work, blend);

	const target = str(params.target);
	// 有 target（比如 bpy export 导出的 PLY）就以它为准，script/stage/params 全部忽略
	const scriptRaw = target ? "" : str(params.script);
	if (!target && !scriptRaw) {
		return { err: "ERROR: 需要 target（参考模型/网格文件）或 script（生成参考数据的 .py）" };
	}
	const targetPath = target
		? (path.isAbsolute(target) ? target : path.resolve(work, target))
		: "";

	// 脚本源：跑第 stage 段，落盘的 stage 数据就是拟合目标
	let scriptPath = "";
	let stageIndex: number | undefined;
	let scriptParams: Record<string, unknown> = {};
	if (scriptRaw) {
		const candidates = path.isAbsolute(scriptRaw)
			? [scriptRaw]
			: [path.resolve(cwd, scriptRaw), path.resolve(work, scriptRaw)];
		const abs = candidates.find((item) => fs.existsSync(item) && fs.statSync(item).isFile());
		if (!abs) {
			return { err: `ERROR: 找不到脚本 ${scriptRaw}\n试过：\n${candidates.join("\n")}` };
		}
		scriptPath = abs;
		stageIndex = int(params.stage);
		if (stageIndex !== undefined && stageIndex < 1) {
			return { err: "ERROR: stage 需要是从 1 开始的整数（跑脚本的第几段）" };
		}
		const parsed = readParams(params.params);
		if (!parsed.ok) return { err: parsed.err };
		scriptParams = parsed.value;
	}

	const inputRows = Array.isArray(params.inputs) ? params.inputs : [];
	const inputs: Record<string, unknown>[] = [];
	for (const row of inputRows) {
		const item = (row ?? {}) as Record<string, unknown>;
		const identifier = str(item.identifier);
		if (!identifier) {
			return { err: 'ERROR: inputs 每项需要 identifier（节点输入的 socket identifier/名字）' };
		}
		const out: Record<string, unknown> = { identifier };
		if (str(item.node)) out.node = str(item.node);
		for (const key of ["min", "max", "step"] as const) {
			const value = num(item[key]);
			if (value !== undefined) out[key] = value;
		}
		if (item.log !== undefined) out.log = Boolean(item.log);
		if (Array.isArray(item.choices)) out.choices = item.choices;
		if (item.components && typeof item.components === "object") out.components = item.components;
		inputs.push(out);
	}

	const fixedRows = Array.isArray(params.fixed) ? params.fixed : [];
	const fixed: Record<string, unknown>[] = [];
	for (const row of fixedRows) {
		const item = (row ?? {}) as Record<string, unknown>;
		const identifier = str(item.identifier);
		if (!identifier) {
			return { err: "ERROR: fixed 每项需要 identifier（节点输入的 socket identifier/名字）" };
		}
		if (!Object.prototype.hasOwnProperty.call(item, "value")) {
			return { err: `ERROR: fixed 里的 ${identifier} 需要 value（固定成多少）` };
		}
		const out: Record<string, unknown> = { identifier, value: item.value };
		if (str(item.node)) out.node = str(item.node);
		fixed.push(out);
	}

	const study = "fit";
	const budget: Record<string, unknown> = { max_trials: 100, timeout_s: 1800 };

	// 落盘位置固定在工作区，AI 不用传；单次运行，无 Optuna storage
	const runDir = path.join(work, "fit_runs", study);
	const reportPath = path.join(runDir, "best.json");
	const minDiff = num(params.min_diff) ?? 5;

	const config: Record<string, unknown> = {
		...(targetPath ? { target: targetPath } : {}),
		...(scriptPath
			? {
				script: scriptPath,
				...(stageIndex !== undefined ? { stage: stageIndex } : {}),
				...(Object.keys(scriptParams).length ? { params: scriptParams } : {}),
			}
			: {}),
		min_diff: minDiff,
		blend: blendPath,
		object,
		modifier,
		node,
		inputs,
		budget,
		study_name: study,
		report: reportPath,
		run_dir: runDir,
	};
	if (fixed.length) config.fixed = fixed;
	return config;
}

function handleFit(params: Record<string, unknown>, env: any, cwd: string) {
	const PY = pythonOf(env);
	const WORK = workspaceOf(env);
	const built = buildConfig(params, WORK, cwd);
	if ("err" in built) return errRes(String(built.err));
	const config = built as Record<string, unknown>;

	const configPath = path.join(WORK, "_fit_config.json");
	try {
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
	} catch (e) {
		return errRes(`写 fit.json 失败：${String((e as Error).message)}`);
	}

	const reportPath = String(config.report);
	const runDir = String(config.run_dir);
	const budgetSeconds = Number((config.budget as Record<string, unknown>).timeout_s ?? 1800);
	const waitMs = Number.isFinite(budgetSeconds) && budgetSeconds > 0
		? Math.ceil(budgetSeconds * 1000) + 300_000
		: 2_100_000;

	const args = ["-m", "fitting.engine", configPath];
	const blenderExe = resolveEnvPath(env?.blender?.exe, env?.__envDir);
	if (blenderExe && fs.existsSync(blenderExe)) args.push("--blender-exe", blenderExe);

	const res = spawnSync(PY, args, {
		encoding: "utf8",
		cwd: SHARD,
		timeout: waitMs,
		env: pyEnv(env),
	});
	const stderr = (res.stderr ?? "").trim();
	const stdout = (res.stdout ?? "").trim();
	const extra = { config: configPath, report: reportPath, run_dir: runDir };

	if (res.error) {
		return errRes(
			`拟合没跑完：${String(res.error)}\n（用的 python：${PY}；配置：${configPath}）`,
			extra,
		);
	}
	if (res.status !== 0) {
		return errRes(
			`拟合失败(exit=${res.status ?? "?"})：\n${(stderr || stdout || "(无输出)").slice(0, 1200)}`,
			extra,
		);
	}

	let report: any;
	try {
		report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
	} catch (e) {
		return errRes(
			`拟合进程结束(exit=0)但读不到报告 ${reportPath}：${String((e as Error).message)}\n${stdout.slice(0, 800)}`,
			extra,
		);
	}

	const bestLoss = report?.loss;
	const trials = report?.trials || {};
	const failedCount = Number(trials.failed ?? 0);
	const verdict = report?.converged ? "已找到" : (report?.ok ? "跑完但未达目标" : "失败");
	const lines = [
		`[fit] ${verdict}：${str(report?.message) || "（无说明）"}`,
		`  最优 loss：${bestLoss ?? "—"}；trial：${trials.total ?? "?"}（失败 ${trials.failed ?? 0}），耗时 ${report?.elapsed_s ?? "?"}s`,
	];
	const warm = report?.warm_start;
	if (warm?.matched && Number(warm?.enqueued) > 0) {
		lines.push(`  热启动：沿用上次 ${warm.enqueued} 组最优参数`);
	}
	if (failedCount > 0) {
		const lastError = str(report?.last_error);
		if (lastError) lines.push(`  最近失败原因：${lastError.slice(0, 300)}`);
	}
	const fields = Array.isArray(report?.fields) ? report.fields : [];
	if (fields.length) {
		const top = fields.slice(0, 8).map((row: any) => {
			const name = String(row?.field ?? "?");
			const diff = Number(row?.diff);
			const best = row?.best;
			const target = row?.target;
			const pct = Number.isFinite(diff) ? `${(diff * 100).toFixed(1)}%` : "?";
			return `${name} ${pct}（${best} → ${target}）`;
		});
		lines.push(`  偏差最大：${top.join("，")}`);
	} else {
		lines.push(`  偏差最大：没有超过 ${((Number(report?.min_diff) || 0) * 100).toFixed(1)}% 的字段`);
	}
	lines.push(
		`  参考数据：${str(report?.target) || "（无）"}`,
		`  最优网格：${str(report?.mesh) || "（无）"}`,
		`  明细：${reportPath}`,
	);
	const seenPath = str(report?.best_seen);
	if (seenPath) lines.push(`  可提升字段：${seenPath}`);
	return okRes(lines.join("\n"), {
		...extra,
		converged: Boolean(report?.converged),
		best_loss: bestLoss ?? null,
		report_json: reportPath,
		best_mesh: str(report?.mesh) || null,
	});
}

// ============ 工具定义 ============
const blenderFitTool = defineTool({
	name: "blender_fit",
	label: "Blender Fit",
	description:
		"黑盒参数拟合：给一份参考模型，自动跑 Optuna，让生成结果的网格字段尽量接近它。\n" +
		"target 是参考模型/网格文件（可用 bpy export 导出的 PLY），全部字段自动提取、逐字段归一化后按组打分。\n" +
		"有 target 时忽略 script/stage/params；没有 target 才跑 script（分段网格脚本：STAGES + build(**params, stage=None)）。\n" +
		"单次运行，不继承旧 study；目标/场景/搜索空间都没变时，会用上次的最优参数热启动。\n" +
		"前提：物体上已有几何节点修改器。\n" +
		"只能写「当前启用、未连线」的输入 socket。\n" +
		"非数值类型（几何/字符串/菜单/材质等）会被拒绝。\n" +
		"角度类插口（subtype=ANGLE）对外一律用「度」。\n" +
		"顶层 node 是导出几何的节点；inputs 每项可写 node 指向其它节点（同一个节点组里）。\n" +
		"fixed：把某些输入定死、不参与搜索。\n" +
		"单轮求值失败只计数并在报告里给出原因，不影响其余 trial。\n" +
		"返回只给结论、偏差最大的字段和报告/产物路径，完整 trial 在报告 JSON 里。",
	parameters: Type.Object({
		// ── Blender 场景：拟合哪个工程、哪个物体、哪个节点 ──────────────
		blend: Type.Optional(Type.String({
			description: "要拟合的 .blend。不填 = 从工作区/当前 flow 的 workflow_state.json 取",
		})),
		object: Type.String({ description: "物体 name" }),
		modifier: Type.String({ description: "物体上的几何节点修改器名（必须已存在）" }),
		node: Type.String({ description: "导出几何的节点 name（也是 inputs 的默认节点）" }),
		// ── 参考数据：target 优先，没有 target 才跑 script ──────────────
		target: Type.Optional(Type.String({
			description: "参考模型/网格文件路径（.ply / .obj / .glb），也可以是 bpy export 导出的 PLY；给了 target 就忽略 script/stage/params",
		})),
		script: Type.Optional(Type.String({
			description: "没有 target 时用：生成参考数据的 .py（分段脚本协议：STAGES + build(**params, stage=None)）",
		})),
		stage: Type.Optional(Type.Integer({
			description: "跑脚本的第几段（从 1 开始，stage=k 表示累计跑到第 k 段；不填 = 最后一段）",
		})),
		params: Type.Optional(Type.Any({
			description: '脚本 SCHEMA 参数的具体值，如 {"n":24,"eps":0.003}；不填 = 用 SCHEMA 默认值',
		})),

		// ── Optuna 搜索空间：搜什么、锁什么 ────────────────────────────
		inputs: Type.Optional(Type.Array(Type.Object({
			node: Type.Optional(Type.String({ description: "参数所在节点 name；不填 = 顶层 node" })),
			identifier: Type.String({ description: "节点输入 socket 的 identifier 或唯一 name（须是未连线的数字类插口）" }),
			min: Type.Optional(Type.Number({ description: "数值下限（和 max 一起给）" })),
			max: Type.Optional(Type.Number({ description: "数值上限" })),
			step: Type.Optional(Type.Number({ description: "步长（可选）" })),
			log: Type.Optional(Type.Boolean({ description: "对数采样（可选）" })),
			choices: Type.Optional(Type.Array(Type.Any(), { description: "枚举候选（可选）" })),
			components: Type.Optional(Type.Any({
				description: "复合类型按分量覆盖：{\"x\":{\"min\":0,\"max\":1}}（可选）",
			})),
		}), {
			description: '要搜索的输入口，如 [{"node":"Noise Texture","identifier":"Scale","min":0.1,"max":3.0}]',
		})),
		fixed: Type.Optional(Type.Array(Type.Object({
			node: Type.Optional(Type.String({ description: "参数所在节点 name；不填 = 顶层 node" })),
			identifier: Type.String({ description: "要定死的节点输入 socket identifier 或唯一 name（须是未连线的数字类插口）" }),
			value: Type.Any({ description: "固定值：数字 / 布尔 / 数组，按该 socket 的类型给" }),
		}), {
			description: '不搜索、每轮写死的输入，如 [{"node":"Noise","identifier":"Scale","value":2.0}]；socket 必须未连线，不能和 inputs 重叠',
		})),

		// ── 报告 ───────────────────────────────────────────────────────
		min_diff: Type.Optional(Type.Number({
			description: "只列出偏差大于这个百分比的字段（默认 5，单位 %）",
		})),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		return handleFit(params, envFor(ctx.cwd), ctx.cwd);
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(blenderFitTool);
}
