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

/** 拼配置文件：填写区（工具参数）在前，自定义区（code）在后——code 里重定义同名变量会覆盖填写区。 */
function buildConfig(p: Record<string, unknown>): string {
	return [
		"# -*- coding: utf-8 -*-",
		"# 本文件由 zone_probe 工具生成（每次覆盖，勿手改）；自定义区在文件末尾。",
		"BLEND = " + py(String(p.blend ?? "")),
		"GROUP = " + py(String(p.group ?? "")),
		"OBJECT = " + py(String(p.object ?? "")),
		"FRAMES = " + py(String(p.frames ?? "")),
		"SETTINGS = []",
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
		"逐帧探测模拟区/ForEach/Repeat 里的数据：引擎负责开档、从第 1 帧顺序预热到起点、逐帧调你的 probe(ctx)、收集并落盘，恒 --save=no 零污染。\n" +
		"你只填 group（节点树名）、frames（如 \"1-20\"；\"30-40\" 会自动预热 29 帧）和 code（探针代码，至少定义 probe(ctx)）。\n" +
		"probe(ctx) 每帧返回一个 dict（键名随意）；大数组自动落盘 npz、输出只回摘要。ctx 可用：frame / centers() / matrices() / verts() / attrs(name) / emit(name, value)。\n" +
		"code 里还可写 selftest()（开档前跑，用已知答案校准判据，assert 失败立即中止，不给假结论）和 setup(tree, obj)（开档后、推帧前的任意代码：设值/加删节点/重接线都行）。",
	promptGuidelines: [
		"动态/逐帧探测（模拟区、ForEach、Repeat，或要看帧演化）首选 zone_probe，不要用 blender_data 的逐帧模式。",
	],
	parameters: Type.Object({
		group: Type.String({
			description: "必填。节点树名（如 M3）",
		}),
		frames: Type.String({
			description: '必填。帧区间："1-10" 采 1..10 / "20" 采 1..20 / "30-40" 采 30..40（前面自动预热）',
		}),
		code: Type.String({
			description:
				"必填。探针代码：至少定义 probe(ctx)；可另写 selftest() / setup(tree, obj)。" +
				"填写区变量（BLEND/GROUP/OBJECT/FRAMES/SETTINGS/ARRAYS_NPZ）已在代码之前定义好，重定义会覆盖它们。",
		}),
		blend: Type.Optional(
			Type.String({
				description: "可选。档路径；不给=用工作区 workflow_state.json 里记的工作档",
			}),
		),
		object: Type.Optional(
			Type.String({
				description: "可选。物体名；不给=自动找挂了该节点树的第一个物体",
			}),
		),
		out: Type.Optional(
			Type.String({
				description: "可选。大数组落盘路径（.npz）；不给=./evidence/probe_arrays_<时间戳>.npz",
			}),
		),
	}),
	async execute(_toolCallId, params) {
		const group = String(params.group ?? "").trim();
		const frames = String(params.frames ?? "").trim();
		const code = String(params.code ?? "").trim();
		if (!group) return say("ERROR: 需要 group（节点树名）", true);
		if (!frames) return say('ERROR: 需要 frames（如 "1-20"）', true);
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
