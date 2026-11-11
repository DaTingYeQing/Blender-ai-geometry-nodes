/**
 * covtrace 扩展 —— 调用边差分（CovTrace 引擎的薄前端）
 *
 * 薄前端：收一张填好的单子 → 生成 eval 脚本 → 起 engine.py → 回报 diff 文件位置。
 * 地址一律现读上一级的 py_environment.json；本文件不含任何绝对路径，可直接进 Git。
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { envFor, pyEnv, pythonOf } from "../lib/env.ts";

type CovConfig = {
	root: string;
	engine: string;
	sourceDir: string;
	blenderExe: string;
	llvmBin: string;
	graphvizBin: string;
	pdbSourceDir: string;
};

/** 地址簿里的相对路径按它所在目录解析。 */
function resolveEnvPath(value: unknown, baseDir: string): string {
	const text = str(value);
	if (!text) return "";
	return path.isAbsolute(text) ? text : path.resolve(baseDir, text);
}

function cov(env: any): CovConfig {
	const cfg = env.covtrace;
	if (!cfg || !cfg.root || !cfg.engine) {
		throw new Error(
			"py_environment.json 里缺少 covtrace 段。需要：\n" +
				'  "covtrace": { "root": "<CovTrace 根目录>", "engine": "<...engine.py>" }',
		);
	}
	const baseDir = env.__envDir || process.cwd();
	return {
		root: resolveEnvPath(cfg.root, baseDir),
		engine: resolveEnvPath(cfg.engine, baseDir),
		sourceDir: resolveEnvPath(cfg.source_dir, baseDir),
		blenderExe: resolveEnvPath(cfg.blender_exe, baseDir),
		llvmBin: resolveEnvPath(cfg.llvm_bin, baseDir),
		graphvizBin: resolveEnvPath(cfg.graphviz_bin, baseDir),
		pdbSourceDir: resolveEnvPath(cfg.pdb_source_dir, baseDir),
	};
}

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
/** Python 字符串字面量。JSON.stringify 的转义规则与 Python 双引号串一致。 */
function pyStr(v: string): string {
	return JSON.stringify(v);
}

/**
 * 输出目录名：优先用 AI 给的名字；否则从测量节点推导。
 * 纯中文节点名会被 safe_name 抹成空，这时退化成 cov_<hash8>。
 */
function nodeNameFor(measure: string, explicit: string): string {
	const clean = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^[._]+|[._]+$/g, "");
	if (explicit) return clean(explicit) || "cov_run";
	const ascii = clean(measure);
	if (ascii) return ascii;
	return "cov_" + createHash("sha1").update(measure).digest("hex").slice(0, 8);
}

/** 把填好的单子拼成 eval 脚本。字段顺序固定，保证同样输入 → 同样 run key。 */
function buildEval(p: Record<string, unknown>): string {
	const target: Array<[string, string]> = [
		["blend", str(p.blend_path)],
		["object", str(p.object_name)],
		["modifier", str(p.modifier_name)],
	];
	const nodeTree = str(p.node_tree);
	if (nodeTree) target.push(["node_tree", nodeTree]);

	const lines: string[] = [
		"# -*- coding: utf-8 -*-",
		'"""CovTrace 自动生成：由 covtrace_run 覆盖，不要手改。"""',
		"",
		"TARGET = {",
	];
	for (const [key, value] of target) {
		lines.push(`    ${pyStr(key)}: ${pyStr(value)},`);
	}
	lines.push("}", "");
	lines.push(`NODE = ${pyStr(str(p.measure_node))}`, "", "");
	lines.push("def evaluate(ctx):");
	lines.push("    ctx.touch_inputs()");
	return lines.join("\n") + "\n";
}

function runEngine(cfg: CovConfig, argv: string[], timeoutMs: number, env: any) {
	const childEnv = pyEnv(env);
	if (cfg.sourceDir) childEnv.COVTRACE_SOURCE_DIR = cfg.sourceDir;
	if (cfg.blenderExe) childEnv.COVTRACE_BLENDER_BIN_DIR = path.dirname(cfg.blenderExe);
	if (cfg.llvmBin) childEnv.COVTRACE_LLVM_BIN_DIR = cfg.llvmBin;
	if (cfg.graphvizBin) childEnv.COVTRACE_GRAPHVIZ_BIN_DIR = cfg.graphvizBin;
	if (cfg.pdbSourceDir) childEnv.COVTRACE_PDB_SOURCE_DIR = cfg.pdbSourceDir;
	const r = spawnSync(pythonOf(env), [cfg.engine, ...argv], {
		encoding: "utf8",
		cwd: cfg.root,
		timeout: timeoutMs,
		maxBuffer: 32 * 1024 * 1024,
		env: childEnv,
	});
	return {
		stdout: (r.stdout ?? "").trim(),
		stderr: (r.stderr ?? "").trim(),
		status: r.status,
		error: r.error,
	};
}

function tail(text: string, limit = 4000): string {
	return text.length > limit ? "…(前文省略)…\n" + text.slice(-limit) : text;
}

// ============ 工具定义 ============
const covtraceTool = defineTool({
	name: "covtrace_run",
	label: "CovTrace Run",
	description:
		"调用边差分：得到「这个节点的大致内部函数」。\n" +
		"必填：blend_path / object_name / modifier_name / measure_node。\n" +
		"参数由后端自动处理：修改器 interface 上的数值参数全部 +1（布尔取反），触发一次求值后直接退出，不保存工程。\n" +
		"跑完只回 ok 和 diff.json 的绝对路径。",
	promptGuidelines: [
		"measure_node 填 idname",
		"不用传参数名或取值：interface 上有几个可改参数就改几个，全部 +1",
		"同一组输入重复跑会命中缓存报错，需要重跑时把 force 设 true。",
		"diff.json 里的 added 节点数包含边端点带回的旧函数，不等于节点自身的实现规模。",
	],
	parameters: Type.Object({
		blend_path: Type.String({ description: ".blend 工程路径" }),
		object_name: Type.String({ description: "物体名" }),
		modifier_name: Type.String({ description: "几何节点修改器名" }),
		measure_node: Type.String({ description: "要探测的节点（ idname ）" }),
		node_name: Type.Optional(
			Type.String({ description: "输出目录名。不填则从 measure_node 推导（纯中文会变成 cov_<hash8>）" }),
		),
		node_tree: Type.Optional(Type.String({ description: "可选：校验用节点树名，留空表示用修改器的 node_group" })),
		force: Type.Optional(Type.Boolean({ description: "同参数已跑过时覆盖（默认 false，会报错）" })),
		keep_all: Type.Optional(
			Type.Boolean({ description: "coverage.json 不过滤路径（默认只留 source/ + intern/）" }),
		),
		keep_cache: Type.Optional(Type.Integer({ description: "每个节点保留最近 N 个 cache，0=不清理（默认 5）" })),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const env = envFor(ctx.cwd);
		const blend = str(params.blend_path);
		const obj = str(params.object_name);
		const mod = str(params.modifier_name);
		const measure = str(params.measure_node);
		if (!blend) return errRes("需要 blend_path");
		if (!obj) return errRes("需要 object_name");
		if (!mod) return errRes("需要 modifier_name");
		if (!measure) return errRes("需要 measure_node（要探测的节点）");
		if (!fs.existsSync(blend)) return errRes(`找不到工程：${blend}`);

		const cfg = cov(env);
		const node = nodeNameFor(measure, str(params.node_name));

		if (!fs.existsSync(cfg.root)) return errRes(`找不到 CovTrace 目录：${cfg.root}`);
		if (!fs.existsSync(cfg.engine)) return errRes(`找不到 CovTrace 引擎：${cfg.engine}`);
		if (cfg.blenderExe && !fs.existsSync(cfg.blenderExe)) {
			return errRes(`找不到插桩 Blender：${cfg.blenderExe}`);
		}

		let code: string;
		try {
			code = buildEval(params);
		} catch (e) {
			return errRes(`ERROR: ${(e as Error).message}`);
		}

		const evalDir = path.join(cfg.root, "eval", "_auto");
		fs.mkdirSync(evalDir, { recursive: true });
		const evalPath = path.join(evalDir, node + ".py");
		fs.writeFileSync(evalPath, code, "utf8");

		const argv = ["run", "--eval", evalPath, "--node", node];
		if (params.force) argv.push("--force");
		if (params.keep_all) argv.push("--keep-all");
		const keep = params.keep_cache;
		if (typeof keep === "number" && Number.isFinite(keep)) argv.push("--keep-cache", String(keep));

		const r = runEngine(cfg, argv, 900_000, env);
		if (r.error) {
			return errRes(`引擎启动失败：${String(r.error)}\n（python: ${pythonOf(env)}）`);
		}
		if (r.status !== 0) {
			return errRes(`CovTrace 失败(exit=${r.status}):\n${tail(r.stdout + "\n" + r.stderr)}`);
		}

		// 从 stdout 里捞运行目录，确认 diff.json 确实写出来了
		// before / after 各打一行 run dir，diff.json 只在最后一行里
		const all = [...r.stdout.matchAll(/>> run dir\s*:\s*(.+)/g)].map((m) => m[1].trim());
		const hit = all.reverse().find((d) => fs.existsSync(path.join(d, "diff.json")));
		const runDir = hit || "";
		const diffPath = runDir ? path.join(runDir, "diff.json") : "";
		if (!diffPath || !fs.existsSync(diffPath)) {
			return errRes(
				`跑完了但没有 diff.json（eval 里的 NODE 是否填了？）\nrun dir: ${runDir || "(未知)"}\n${tail(r.stdout)}`,
			);
		}

		return okRes(`ok\ndiff: ${diffPath}`, { run_dir: runDir, diff: diffPath });
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(covtraceTool);
}
