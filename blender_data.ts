/**
 * blender_data 扩展 —— 数据探针：改值 → 双轮烘焙 → room.diff，两种模式
 *
 *   mode=geometry：给带几何输出的节点 name，脚本自动抓上游闭包，可 set 任意上游节点，
 *                  烘焙该几何输出，room.run() + _diff.diff() 输出变化。
 *   mode=numeric ：给 节点名.插座名 数组(nodes)，脚本读每个 socket 的数值（字段→提示去几何模式）。
 *   frames 可选 "起始-结束"（≤15帧）：geometry→逐帧演化统计；numeric→逐帧值列表；不填=单帧。
 *
 * 引用规则：节点用 name，socket 用名称/identifier（与 node_builder 一致）。
 *
 * 薄前端：收参数 → payload 写工作区 → 起 blender_channel.py（由它把
 * skills/execution/blender_data/mian.py 递进 Blender，恒 --save=no 零污染）→ 读回结果原样返回。
 * 工作档由 channel 找工作区 workflow_state.json 定（先用 wf_plan 建档），前端不过手。
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
const WORK: string = ENV.workspace.root; // 工作区：payload / 烘焙产物都落这
const CHANNEL = path.join(AGENT, "skills", "execution", "blender_channel.py"); // 唯一进 Blender 的门
const PROBE = path.join(AGENT, "skills", "execution", "blender_data", "mian.py"); // 探针载荷，由 channel 递进 Blender
const PAYLOAD = path.join(WORK, "_bd_payload.json"); // payload 落工作区，不写 skill 目录

function errRes(text: string, extra?: Record<string, unknown>) {
	return { content: [{ type: "text", text }], details: { ok: false, ...extra }, isError: true };
}
function okRes(text: string, extra?: Record<string, unknown>) {
	return { content: [{ type: "text", text }], details: { ok: true, ...extra } };
}

function toJsonArray(s: string): unknown[] | null {
	const t = (s ?? "").trim();
	if (!t) return [];
	try { const v = JSON.parse(t); return Array.isArray(v) ? v : null; }
	catch { return null; }
}

/** 写 payload 到工作区并跑 channel（它递交 mian.py 进 Blender）。结果读 out_dir/result.json。 */
function runBackend(payload: Record<string, unknown>): string | ReturnType<typeof errRes> {
	try {
		fs.writeFileSync(PAYLOAD, JSON.stringify(payload, null, 2), "utf-8");
	} catch (e) {
		return errRes("写 payload 失败: " + String((e as Error).message));
	}
	// --save=no 恒零污染；-- 之后是 mian.py 自己的参数；不给 read，channel 自己找工作档
	const res = spawnSync(PY, [CHANNEL, PROBE, "--save=no", "--timeout=170", "--", PAYLOAD], {
		encoding: "utf8",
		cwd: WORK,
		timeout: 180_000, // 略高于 channel 内部默认，让它的超时文案先说话
		env: { ...process.env, PYTHONIOENCODING: "utf-8" },
	});
	const stdout = (res.stdout ?? "").trim();
	const stderr = (res.stderr ?? "").trim();
	if (res.error) {
		return errRes(
			`python 启动失败：${String(res.error)}\n（用的 python：${PY}，来自 py_environment.json）`,
			{ stdout, stderr },
		);
	}
	if (res.status !== 0) {
		return errRes(`探针失败(exit=${res.status ?? "?"}):\n${stdout || stderr || String(res.error || "")}`, { stdout, stderr });
	}
	const resultFile = path.join(String(payload.out_dir ?? ""), "result.json");
	try {
		const data = JSON.parse(fs.readFileSync(resultFile, "utf8"));
		if (data?.ok === false) return errRes("后端错误: " + (data.error ?? "未知"));
		return JSON.stringify(data, null, 2);
	} catch (e) {
		return errRes(`后端未生成有效 result.json(${resultFile})：\n${stdout || stderr || String((e as Error).message)}`, { stdout, stderr });
	}
}

function handleData(params: Record<string, unknown>) {
	const mode = ((params.mode as string) ?? "geometry").trim();
	const group = ((params.group as string) ?? "").trim();
	if (!group) return errRes("ERROR: 需要 group（要烘焙的目标几何组名，如 AI_Shard_Main）");
	const object = ((params.object as string) ?? "").trim();

	const sets = mode === "geometry"
		? (params.sets && String(params.sets).trim() ? toJsonArray(String(params.sets)) : [])
		: [];
	if (sets === null) return errRes("ERROR: sets 不是合法 JSON 数组");
	const outDir = ((params.out_dir as string) || path.join(WORK, `bd_run_${Date.now()}`)).trim();

	const payload: Record<string, unknown> = { object, group, mode, sets, out_dir: outDir };

	// frames 对两种模式都生效（≤15帧）
	const frames = ((params.frames as string) ?? "").trim();
	if (frames) payload.frames = frames;

	if (mode === "geometry") {
		const node = ((params.node as string) ?? "").trim();
		if (!node) return errRes("ERROR: geometry 模式需要 node(带几何输出的节点 name)");
		payload.node = node;
	} else if (mode === "numeric") {
		const nodes = toJsonArray(String(params.nodes ?? ""));
		if (nodes === null || !nodes.length) return errRes('ERROR: numeric 模式需要 nodes(数组，如 ["矢量运算.001.Value"])');
		payload.nodes = nodes;
	} else {
		return errRes("ERROR: mode 必须是 geometry 或 numeric");
	}

	const text = runBackend(payload);
	if (typeof text !== "string") return text;
	try {
		const data = JSON.parse(text);
		const head = `[blender_data] ${mode === "geometry" ? "几何" : "数值"}模式 完成（自动还原，未保存原档）`;
		return okRes(head + "\n" + JSON.stringify(data, null, 2), { mode, result: data });
	} catch {
		return okRes(text);
	}
}

// ============ 工具定义 ============
const blenderDataTool = defineTool({
	name: "blender_data",
	label: "Blender Data",
	description:
		"数据探针：改值 → 双轮烘焙 → room.diff。恒 --save=no 零污染（自动还原，不存原档）。\n" +
		"两种模式：geometry 给一个带几何输出的节点 name（脚本抓它上游闭包、烘出该几何输出、比改值前后）；numeric 给 节点名.插座名 数组，只读这些 socket 的数值（不设值）。\n" +
		"geometry 只吃几何节点，numeric 只吃标量/向量字段，给错会提示转模式。\n" +
		"frames 填了就是逐帧（≤15帧）：geometry 只回跨帧有变化的项，numeric 回逐帧值列表；不填=单帧。sets 只在 geometry 单帧模式生效。\n" +
		"示例：blender_data group=AI_Shard_Main mode=geometry node=设置位置 sets='[{\"node\":\"细分网格\",\"prop\":\"Level\",\"value\":1}]'",
	promptGuidelines: [
		"blender_data 只用numeric模式读函数值：静态几何用 bpy、动态逐帧探测用 zone_probe",
	],
	parameters: Type.Object({
		mode: Type.Optional(Type.String({ description: "geometry | numeric，默认 geometry" })),
		group: Type.String({ description: "必填。要烘焙的目标几何组名（如 AI_Shard_Main）" }),
		object: Type.Optional(Type.String({ description: "可选。挂该组的物体名；不给时自动找" })),
		node: Type.Optional(Type.String({ description: "mode=geometry：节点 name" })),
		nodes: Type.Optional(Type.String({ description: 'mode=numeric：节点名.插座名 数组字符串，如 ["矢量运算.001.Value"]' })),
		frames: Type.Optional(Type.String({ description: '可选：帧范围 如 "1-15"（≤15帧）。geometry→逐帧演化统计；numeric→逐帧值列表；不填=单帧' })),
		sets: Type.Optional(Type.String({ description: '改值轮 JSON 数组，仅 geometry 模式生效' })),
		out_dir: Type.Optional(Type.String({ description: "烘焙输出根目录；省略用默认（工作区 bd_run_<时间戳>）" })),
	}),
	async execute(_toolCallId, params) {
		return handleData(params);
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(blenderDataTool);
}
