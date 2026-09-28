/**
 * blender_data 扩展 —— 数据探针：改值 → 双轮烘焙 → room.diff，两种模式
 *
 *   mode=geometry：给带几何输出的节点 name，脚本自动抓上游闭包，可 set 任意上游节点，
 *                  烘焙该几何输出，room.run() + _diff.diff() 输出变化。
 *   mode=numeric ：给一串 {节点, 插座}(nodes)，脚本读每个 socket 的数值（字段→提示去几何模式）。
 *   from/to 可选：采集帧区间（≤15帧，不填=单帧）。geometry→逐帧演化统计；numeric→逐帧值列表。
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

/** 帧号 → 后端要的 "起始-结束" 串。from 不给算 1；≤15 帧上限跟后端 parse_frames 对齐。 */
function framesToString(from: unknown, to: unknown): string | { err: string } {
	const rawTo = to === undefined || to === null || to === "" ? NaN : Number(to);
	if (!Number.isFinite(rawTo)) return { err: "ERROR: 需要 to（结束帧，整数）" };
	const rawFrom = from === undefined || from === null || from === "" ? 1 : Number(from);
	if (!Number.isFinite(rawFrom)) return { err: "ERROR: from 必须是整数（起始帧）" };
	const a = Math.trunc(rawFrom);
	const b = Math.trunc(rawTo);
	if (a < 1) return { err: `ERROR: from 必须 ≥ 1，收到 ${a}` };
	if (b < a) return { err: `ERROR: to(${b}) 不能小于 from(${a})` };
	if (b - a + 1 > 15) return { err: `ERROR: 帧数上限 15，from=${a} to=${b} 共 ${b - a + 1} 帧` };
	return `${a}-${b}`;
}

/** nodes 每项 {node, socket} → 后端 _collect_targets 要的 "节点名.插座名"。 */
function nodeSocketsToStrings(rows: unknown): string[] | { err: string } {
	const list = Array.isArray(rows) ? rows : [];
	if (!list.length) return { err: "ERROR: numeric 模式需要 nodes（每项给节点名和插座名）" };
	const out: string[] = [];
	for (const row of list) {
		const r = row as Record<string, unknown>;
		const n = String(r?.node ?? "").trim();
		const s = String(r?.socket ?? "").trim();
		if (!n || !s) return { err: 'ERROR: nodes 每项需要 node 和 socket 两个字段，如 {"node":"矢量运算.001","socket":"Value"}' };
		out.push(`${n}.${s}`);
	}
	return out;
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

	const sets = mode === "geometry" && Array.isArray(params.sets) ? params.sets : [];
	const outDir = ((params.out_dir as string) || path.join(WORK, `bd_run_${Date.now()}`)).trim();

	const payload: Record<string, unknown> = { object, group, mode, sets, out_dir: outDir };

	// frames 对两种模式都生效（≤15 帧）；不填=单帧
	if (params.to !== undefined && params.to !== null && String(params.to).trim() !== "") {
		const frames = framesToString(params.from, params.to);
		if (typeof frames !== "string") return errRes(frames.err);
		payload.frames = frames;
	}

	if (mode === "geometry") {
		const node = ((params.node as string) ?? "").trim();
		if (!node) return errRes("ERROR: geometry 模式需要 node(带几何输出的节点 name)");
		payload.node = node;
	} else if (mode === "numeric") {
		const nodes = nodeSocketsToStrings(params.nodes);
		if (!Array.isArray(nodes)) return errRes(nodes.err);
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
		"数据探针：改值 → 双轮烘焙 → room.diff。\n" +
		"两种模式：geometry 给一个带几何输出的节点 name（脚本抓它上游闭包、烘出该几何输出、比改值前后）；numeric 给一串节点插座，只读这些 socket 的数值。\n" +
		"geometry 只吃几何节点，numeric 只吃标量/向量字段。\n" +
		"sets 只在 geometry 单帧模式生效。",
	parameters: Type.Object({
		mode: Type.Optional(Type.Union([
			Type.Literal("geometry"),
			Type.Literal("numeric"),
		], { description: "geometry=看几何变化；numeric=只读数值" })),
		group: Type.String({ description: "必填。要烘焙的目标几何组名" }),
		object: Type.Optional(Type.String({ description: "必填。挂该组的物体名" })),
		node: Type.Optional(Type.String({ description: "mode=geometry：带几何输出的节点 name" })),
		nodes: Type.Optional(Type.Array(Type.Object({
			node: Type.String({ description: "节点 name" }),
			socket: Type.String({ description: "插座名或 identifier（插座重名的节点必须用 identifier）" }),
		}), { description: "mode=numeric：要读数的插座，每个插座一个对象。" })),
		to: Type.Optional(Type.Integer({
			description: "结束帧（整数）。与 from 组成采集区间，最多 15 帧；不填则只采集单帧。",
		})),
		from: Type.Optional(Type.Integer({
			description: "起始帧（整数，不填=1）。只测单帧时 from 和 to 填同一个数。",
		})),
		sets: Type.Optional(Type.Array(Type.Object({
			node: Type.String({ description: "节点 name" }),
			prop: Type.String({ description: "接口名或属性名。设值时填接口 identifier；同名接口重名的节点必须用 identifier" }),
			value: Type.Any({ description: "要设的值：数字 / 布尔 / 数组 / 字符串，按该接口或属性的类型给" }),
		}), { description: "改值轮：先设这些值再烘一次，和原值那轮对比。仅 geometry 模式生效。" })),
		out_dir: Type.Optional(Type.String({ description: "烘焙输出根目录；省略用默认（工作区 bd_run_<时间戳>）" })),
	}),
	async execute(_toolCallId, params) {
		return handleData(params);
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(blenderDataTool);
}
