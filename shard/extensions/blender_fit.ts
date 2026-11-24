/**
 * blender_fit 扩展 —— 黑盒拟合：填参数单子 → Optuna 搜索 → 报告落盘
 *
 * 前端只做三件事：把表单拼成 fit.json、起 fitting.engine、从报告里抽一句摘要。
 * 完整 trial、最优参数、每轮 PLY 都在文件里，不塞进上下文。
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

function buildConfig(params: Record<string, unknown>, work: string): Record<string, unknown> | { err: string } {
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

	const outputs = Array.isArray(params.outputs)
		? (params.outputs as unknown[]).map(String).map((s) => s.trim()).filter(Boolean)
		: [];
	if (!outputs.length) {
		return { err: 'ERROR: 需要 outputs（网格字段数组，如 ["volume","area","extents"]）' };
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

	const targets: Record<string, number> = {};
	const weights: Record<string, number> = {};
	const lossRows = Array.isArray(params.loss_targets) ? params.loss_targets : [];
	for (const row of lossRows) {
		const item = (row ?? {}) as Record<string, unknown>;
		const field = str(item.field);
		const value = num(item.value);
		if (!field || value === undefined) {
			return { err: 'ERROR: loss_targets 每项需要 field（字段名）和 value（目标数值）' };
		}
		targets[field] = value;
		const weight = num(item.weight);
		if (weight !== undefined) weights[field] = weight;
	}
	if (!Object.keys(targets).length) {
		return { err: 'ERROR: 需要至少一个 loss_targets（如 [{"field":"volume","value":3.0}]）' };
	}

	const study = str(params.study_name) || "fit";
	const maxTrials = int(params.max_trials) ?? 100;
	const timeoutS = num(params.timeout_s) ?? 1800;
	const targetLoss = num(params.target_loss);
	const seed = int(params.seed);
	const frame = int(params.frame);

	const budget: Record<string, unknown> = { max_trials: maxTrials, timeout_s: timeoutS };
	if (targetLoss !== undefined) budget.target_loss = targetLoss;
	if (seed !== undefined) budget.seed = seed;

	const loss: Record<string, unknown> = { targets };
	if (Object.keys(weights).length) loss.weights = weights;

	const config: Record<string, unknown> = {
		blend: blendPath,
		object,
		modifier,
		node,
		inputs,
		outputs,
		loss,
		budget,
		study_name: study,
		storage: str(params.storage) || "journal://" + path.join(work, "fit_" + study + ".log").replace(/\\/g, "/"),
		report: str(params.report) || path.join(work, "fit_report.json"),
		run_dir: str(params.run_dir) || path.join(work, "fit_runs", study),
	};
	if (fixed.length) config.fixed = fixed;
	if (frame !== undefined) config.frame = frame;
	const startup = num(params.startup_timeout_s);
	const evalTimeout = num(params.eval_timeout_s);
	if (startup !== undefined) config.startup_timeout_s = startup;
	if (evalTimeout !== undefined) config.eval_timeout_s = evalTimeout;
	return config;
}

function handleFit(params: Record<string, unknown>, env: any) {
	const PY = pythonOf(env);
	const WORK = workspaceOf(env);
	const built = buildConfig(params, WORK);
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
	const storage = String(config.storage);
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
	const extra = { config: configPath, report: reportPath, run_dir: runDir, storage };

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

	const bestLoss = report?.best?.loss;
	const trials = report?.trials || {};
	const verdict = report?.converged ? "已找到" : (report?.ok ? "跑完但未达目标" : "失败");
	const lines = [
		`[fit] ${verdict}：${str(report?.message) || "（无说明）"}`,
		`  最优 loss：${bestLoss ?? "—"}；trial：${trials.total ?? "?"}（失败 ${trials.failed ?? 0}），耗时 ${report?.elapsed_s ?? "?"}s`,
		`  报告：${reportPath}`,
		`  每轮产物：${runDir}`,
		`  存储：${storage}`,
		`  （完整参数、每轮度量都在报告 JSON 里，需要再加 read 读）`,
	];
	return okRes(lines.join("\n"), {
		...extra,
		converged: Boolean(report?.converged),
		best_loss: bestLoss ?? null,
		report_json: reportPath,
	});
}

// ============ 工具定义 ============
const blenderFitTool = defineTool({
	name: "blender_fit",
	label: "Blender Fit",
	description:
		"黑盒参数拟合：按一张参数单子跑 Optuna，自动写值、求值、算网格字段、打分。\n" +
		"前提：物体上已有几何节点修改器（没有先用 blender_build 的 bind），输入的 socket 必须未连线。\n" +
		"顶层 node 是导出几何的节点；inputs 每项可写 node 指向其它节点（同一个节点组里）。\n" +
		"fixed：把某些输入定死、不参与搜索（每轮求值前写回），用于锁住上游模块的参数；不能和 inputs 重叠。\n" +
		"返回只给结论和报告/产物路径，完整 trial 和最优参数在报告 JSON 里。",
	parameters: Type.Object({
		blend: Type.Optional(Type.String({
			description: "要拟合的 .blend。不填 = 从工作区/当前 flow 的 workflow_state.json 取",
		})),
		object: Type.String({ description: "物体 name" }),
		modifier: Type.String({ description: "物体上的几何节点修改器名（必须已存在）" }),
		node: Type.String({ description: "导出几何的节点 name（也是 inputs 的默认节点）" }),
		inputs: Type.Optional(Type.Array(Type.Object({
			node: Type.Optional(Type.String({ description: "参数所在节点 name；不填 = 顶层 node" })),
			identifier: Type.String({ description: "节点输入 socket 的 identifier 或唯一 name" }),
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
			identifier: Type.String({ description: "要定死的节点输入 socket identifier 或唯一 name" }),
			value: Type.Any({ description: "固定值：数字 / 布尔 / 数组，按该 socket 的类型给" }),
		}), {
			description: '不搜索、每轮写死的输入，如 [{"node":"Noise","identifier":"Scale","value":2.0}]；socket 必须未连线，不能和 inputs 重叠',
		})),
		outputs: Type.Array(Type.String(), {
			description: '要量化的网格字段，如 ["volume","area","extents"]',
		}),
		loss_targets: Type.Array(Type.Object({
			field: Type.String({ description: "字段名（须在 outputs 里，或它的子字段如 extents.0）" }),
			value: Type.Number({ description: "目标值" }),
			weight: Type.Optional(Type.Number({ description: "权重（默认 1；量纲大的字段调小）" })),
		}), {
			description: '目标列表，如 [{"field":"volume","value":3.0},{"field":"area","value":12.0,"weight":0.5}]',
		}),
		max_trials: Type.Optional(Type.Integer({ description: "最多 trial 数（默认 100）" })),
		timeout_s: Type.Optional(Type.Number({ description: "墙钟时间上限秒（默认 1800）" })),
		target_loss: Type.Optional(Type.Number({ description: "收敛门槛：最优 loss ≤ 它就停（可选）" })),
		seed: Type.Optional(Type.Integer({ description: "TPE 随机种子（可选）" })),
		study_name: Type.Optional(Type.String({ description: "study 名（默认 fit）" })),
		storage: Type.Optional(Type.String({
			description: "Optuna storage；默认 journal://<工作区>/fit_<study>.log",
		})),
		report: Type.Optional(Type.String({
			description: "报告 JSON 路径；默认 <工作区>/fit_report.json",
		})),
		run_dir: Type.Optional(Type.String({
			description: "每轮 PLY/JSON 目录；默认 <工作区>/fit_runs/<study>",
		})),
		frame: Type.Optional(Type.Integer({ description: "取第几帧（可选）" })),
		startup_timeout_s: Type.Optional(Type.Number({ description: "Blender 启动超时秒（默认 180）" })),
		eval_timeout_s: Type.Optional(Type.Number({ description: "单轮求值超时秒（默认 300）" })),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		return handleFit(params, envFor(ctx.cwd));
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(blenderFitTool);
}
