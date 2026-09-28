/**
 * zone_probe 扩展 —— frame_probe.py 的 TS 前端（薄开关）
 *
 * 只做三件事：收参数 → 拼一份探针配置文件（填写区 + 自定义区）→ 起 blender_channel.py
 * （--read=new --save=no，零污染）→ 把引擎输出原样带回。
 * 引擎是 skills/execution/frame_probe.py；本文件不含任何绝对路径，可直接进 Git。
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
const WORK: string = ENV.workspace.root; // 工作区：生成的配置 / 落盘 npz 都在这
const CHANNEL = path.join(AGENT, "skills", "execution", "blender_channel.py");
const ENGINE = path.join(AGENT, "skills", "execution", "frame_probe.py");
const CFG = path.join(WORK, "zone_probe_config.py"); // 生成的探针配置（每次覆盖）
const STATE = path.join(WORK, "workflow_state.json"); // 工作档记录

function say(text: string, isError = false) {
	return { content: [{ type: "text", text }], details: { ok: !isError }, isError };
}

/** 工作档：workflow_state.json 里的 blend 字段（读不到就空串）。 */
function workBlend(): string {
	try {
		const st = JSON.parse(fs.readFileSync(STATE, "utf8"));
		return typeof st.blend === "string" ? st.blend : "";
	} catch {
		return "";
	}
}

/** Python 字符串字面量：JSON 转义规则是 Python 的子集，直接借 JSON.stringify。 */
function py(s: string): string {
	return JSON.stringify(s);
}

/**
 * from / to 两个数字 → 后端认的 FRAMES 串。
 * 永远拼全式 "a-b"（后端对 "20" 和 "1-20" 处理等价，全式绕开省略规则）。
 */
function framesToString(from: unknown, to: unknown): string | { err: string } {
	const rawTo = to === undefined || to === null || to === "" ? NaN : Number(to);
	if (!Number.isFinite(rawTo)) return { err: "ERROR: 需要 to（结束帧，整数）" };
	const rawFrom = from === undefined || from === null || from === "" ? 1 : Number(from);
	if (!Number.isFinite(rawFrom)) return { err: "ERROR: from 必须是整数（起始帧）" };
	const a = Math.trunc(rawFrom);
	const b = Math.trunc(rawTo);
	if (a < 1) return { err: `ERROR: from 必须 ≥ 1，收到 ${a}` };
	if (b < a) return { err: `ERROR: to(${b}) 不能小于 from(${a})` };
	return `${a}-${b}`;
}

/** 拼配置文件：填写区（工具参数）在前，自定义区（code）在后——code 里重定义同名变量会覆盖填写区。 */
function buildConfig(p: Record<string, unknown>): string {
	return [
		"# -*- coding: utf-8 -*-",
		"# 本文件由 zone_probe 工具生成（每次覆盖，勿手改）；自定义区在文件末尾。",
		"BLEND = " + py(String(p.blend ?? "")),
		"GROUP = " + py(String(p.group ?? "")),
		"OBJECT = " + py(String(p.object ?? "")),
		"FRAMES = " + py(String(p.frames ?? "")),
		"ARRAYS_NPZ = " + py(String(p.out ?? "")),
		"",
		"# ================== 自定义区（zone_probe 的 code 参数，原样拼在这） ==================",
		String(p.code ?? ""),
		"",
	].join("\n");
}

const zoneProbeTool = defineTool({
	name: "zone_probe",
	label: "Zone Probe",
	description:
		"逐帧探测模拟区里的数据：引擎负责开档、从第 1 帧顺序预热到起点、逐帧调你的 probe(ctx)。\n" +
		"你只填 group（节点树名）、from/to（帧区间）和 code（探针代码）。\n" +
		"probe(ctx) 每帧返回一个 dict（键名随意）；大数组自动落盘 npz、输出只回摘要。ctx 可用：frame / centers() / matrices() / verts() / attrs(name) / emit(name, value)。\n" +
		"本工具只探测：恒 --save=no，要改初始条件请先用 blender_build 改档。",

	parameters: Type.Object({
		group: Type.String({
			description: "必填。节点树名",
		}),
		to: Type.Integer({
			description: "必填。结束帧。引擎会先从第 1 帧顺序预热到这里，再采集。",
		}),
		from: Type.Optional(Type.Integer({
			description: "起始帧（不填=1）。只测单帧时 from 和 to 填同一个数。",
		})),
		code: Type.String({
			description:
				"必填。探针代码：只定义 probe(ctx)（每帧调一次，返回 dict）——本工具不改模拟区。" +
				"填写区变量（BLEND/GROUP/OBJECT/FRAMES/ARRAYS_NPZ）已在代码之前定义好。",
		}),
		blend: Type.Optional(
			Type.String({
				description: "档路径；不给= workflow_state.json 里记的工作档",
			}),
		),
		object: Type.String({
			description: "必填，物体名",
		}),
		out: Type.Optional(
			Type.String({
				description: "可选。大数组落盘路径（.npz）；不给=./evidence/probe_arrays_<时间戳>.npz",
			}),
		),
	}),
	async execute(_toolCallId, params) {
		const group = String(params.group ?? "").trim();
		const code = String(params.code ?? "").trim();
		if (!group) return say("ERROR: 需要 group（节点树名）", true);
		const frames = framesToString(params.from, params.to);
		if (typeof frames !== "string") return say(frames.err, true);
		if (!code) {
			return say(
				'ERROR: 需要 code —— 探针代码，至少定义 probe(ctx)。' +
					'这个工具不接受"只跑模拟区、什么都不探"。',
				true,
			);
		}

		let blend = String(params.blend ?? "").trim();
		if (!blend) blend = workBlend();
		if (!blend) {
			return say(
				"ERROR: 没给 blend，工作区也没有 workflow_state.json。" +
					"先 wf_plan 建档，或显式传 blend。",
				true,
			);
		}

		try {
			fs.writeFileSync(CFG, buildConfig({ ...params, blend, group, frames, code }), "utf8");
		} catch (e) {
			return say(`ERROR: 写探针配置失败：${String((e as Error).message)}`, true);
		}

		// 探针要跑完整段预热 + 采集，给足时间；channel 先超时，好让它自己的文案先说话
		const timeout = 900;
		const r = spawnSync(
			PY,
			[CHANNEL, ENGINE, "--read=new", "--save=no", `--timeout=${timeout - 30}`, "--", CFG],
			{
				encoding: "utf8",
				cwd: WORK,
				timeout: (timeout + 20) * 1000,
				env: { ...process.env, PYTHONIOENCODING: "utf-8" },
			},
		);
		const stdout = (r.stdout ?? "").trim();
		const stderr = (r.stderr ?? "").trim();
		const out = [stdout, stderr && `[stderr] ${stderr}`].filter(Boolean).join("\n");
		if (r.error) {
			return say(
				`python 启动失败：${String(r.error)}\n（用的 python：${PY}，来自 py_environment.json）`,
				true,
			);
		}
		if (r.status !== 0) {
			return say(out || `blender_channel 退出码 ${r.status}（无输出）\n配置留在 ${CFG}`, true);
		}
		return say(out);
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(zoneProbeTool);
}
