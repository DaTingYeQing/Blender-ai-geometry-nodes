/**
 * blender_build 扩展 —— 建/删/设/连/断节点 + 组边界接口
 *
 * 薄前端：收参数 → payload 写工作区 → 起 skills/execution/node_build.py → 原样带回。
 * 拼批次、定落盘、找工作档、经 blender_channel 进 Blender、读回业务结果、拼摘要，
 * 全在后端 node_build.py 里；本文件不碰 blender.exe，也不自己读工作档。
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
const WORK: string = ENV.workspace.root; // 工作区：payload / 批次 / 快照 / 工作档都在这
const NODE_BUILD = path.join(AGENT, "skills", "execution", "node_build.py");
const PAYLOAD = path.join(WORK, "_build_payload.json"); // payload 落工作区，不写 skill 目录

function errRes(text: string, extra?: Record<string, unknown>) {
	return { content: [{ type: "text", text }], details: { ok: false, ...extra }, isError: true };
}
function okRes(text: string, extra?: Record<string, unknown>) {
	return { content: [{ type: "text", text }], details: { ok: true, ...extra } };
}

/**
 * 写 payload 到工作区并跑 node_build.py。脚本只 print 一个 JSON：
 * 能解析出 JSON 就返回它（业务失败也是 ok:false 的 JSON，summary 已拼好人话）；
 * 连 JSON 都没有（python 崩了 / 启动失败）才报 err。
 */
function runBuild(payload: Record<string, unknown>) {
	try {
		fs.writeFileSync(PAYLOAD, JSON.stringify(payload, null, 2), "utf8");
	} catch (e) {
		return { err: `写 payload 失败: ${String((e as Error).message)}` };
	}
	const res = spawnSync(PY, [NODE_BUILD, PAYLOAD], {
		encoding: "utf8",
		cwd: WORK,
		timeout: 150_000, // 后端内含 Blender 默认 120s，略加大罩住
		env: { ...process.env, PYTHONIOENCODING: "utf-8" },
	});
	const stdout = (res.stdout ?? "").trim();
	const stderr = (res.stderr ?? "").trim();
	if (res.error) {
		return { err: `python 启动失败：${String(res.error)}\n（用的 python：${PY}，来自 py_environment.json）` };
	}
	let data: any = null;
	try {
		data = JSON.parse(stdout);
	} catch {
		// stdout 不是 JSON → 下面统一报错
	}
	if (!data) {
		return {
			err: `python 失败(exit=${res.status ?? "?"})，脚本无 JSON 输出:\n${stdout || stderr || "(无输出)"}`,
		};
	}
	return { data };
}

// ============ action → 批次字段 ============
// 每个 handler 只做一件事：把对应参数挑出来、查非空、放进批次。其余校验全在后端。

type Batch = Record<string, unknown>;

function needList(v: unknown, what: string): string[] | { err: string } {
	const arr = Array.isArray(v) ? v.map(String).filter(Boolean) : [];
	if (!arr.length) return { err: `ERROR: ${what}` };
	return arr;
}

function needObjs(v: unknown, what: string): unknown[] | { err: string } {
	const arr = Array.isArray(v) ? v : [];
	if (!arr.length) return { err: `ERROR: ${what}` };
	return arr;
}

/** 各 action 的批次拼法；返回错误文案或批次片段 */
const ACTIONS: Record<string, (p: Record<string, unknown>) => Batch | { err: string }> = {
	add_item: (p) => {
		const items = needObjs(p.items, 'action=add_item 需要 items：[{"zone":zone输出节点name,"socket_type":"Float/Vector/Geometry","item_name":状态名}]');
		return Array.isArray(items) ? { add_item: items } : items;
	},
	add: (p) => {
		const ids = needList(p.ids, "action=add 需要 ids（节点 idname 数组），如 [\"GeometryNodeMeshCube\"]");
		return Array.isArray(ids) ? { add: ids } : ids;
	},
	del: (p) => {
		const nodes = needList(p.nodes, "action=del 需要 nodes（节点 name 数组，先 node_find/node_full 查准名字）");
		return Array.isArray(nodes) ? { del: nodes } : nodes;
	},
	link: (p) => {
		const wires = needList(p.wires, "action=link 需要 wires：[\"节点name.接口 → 节点name.接口\"]，如 [\"Cube.Mesh → Set Position.Geometry\"]");
		if (!Array.isArray(wires)) return wires;
		const batch: Batch = { link: wires };
		if (Array.isArray(p.sets) && p.sets.length) batch.set = p.sets; // link 可顺带 set（后端顺序 set 在 link 之前）
		return batch;
	},
	unlink: (p) => {
		const wires = needList(p.wires, "action=unlink 需要 wires（同 link 格式；短式「节点.接口」只断该节点输入上的线）");
		return Array.isArray(wires) ? { unlink: wires } : wires;
	},
	set: (p) => {
		const sets = needObjs(p.sets, 'action=set 需要 sets：[{"node":name,"prop":接口名或属性名,"value":值}]');
		if (!Array.isArray(sets)) return sets;
		const batch: Batch = { set: sets };
		if (Array.isArray(p.wires) && p.wires.length) batch.link = p.wires; // set 可顺带 link
		return batch;
	},
	interface: (p) => {
		const ifs = needObjs(p.ifs, 'action=interface 需要 ifs：[{"direction":"input/output","name":接口名,"socket_type":接口类型}]');
		return Array.isArray(ifs) ? { interface: ifs } : ifs;
	},
};

function handleBuild(params: Record<string, unknown>) {
	const action = ((params.action as string) ?? "").trim();
	const handler = ACTIONS[action];
	if (!handler) {
		return errRes(`ERROR: action 六选一：${Object.keys(ACTIONS).join("/")}`);
	}
	const group = ((params.group as string) ?? "").trim();
	if (!group) {
		return errRes("ERROR: 必须指定 group（要操作的目标节点组名）。组不存在或想新建组，先 action=interface 用该组名建接口（会建组），再 add 等。");
	}
	const batch = handler(params);
	if ("err" in batch) return errRes(String(batch.err));

	const payload: Record<string, unknown> = {
		...batch,
		tree: group,
		out_dir: WORK, // 批次 / 结果 / 快照都落工作区
		workdir: WORK, // 去这儿找 workflow_state.json 定工作档（找到就建完存回）
	};
	const r = runBuild(payload);
	if (r.err) return errRes(r.err);
	const d = r.data;

	const head = `[build ${action}] 组 "${d.tree ?? group}"`;
	if (!d?.ok) {
		const why = d?.summary || d?.error || "未知错误";
		// 业务失败 ≠ 没落盘：批次里已成功的动作照旧存回工作档，这里明确告知
		const savedLine = d?.saved ? `\n（本批已存回工作档：${d.saved}）` : "";
		return errRes(`${head} 失败：\n${why}${savedLine}`, { errors: d?.errors, channel: d?.channel, saved: d?.saved });
	}
	const lines = [`${head}：${d.summary ?? "全部成功"}`];
	if (d.saved) lines.push(`  已存回工作档：${d.saved}`);
	else lines.push("  未存盘（没找工作档；先 wf_plan 建档再 build 才会落盘）");
	return okRes(lines.join("\n"), {
		tree: d.tree, applied: d.applied, saved: d.saved,
		screen: d.screen_json, batch: d.batch, result: d.result_json,
	});
}

// ============ 工具定义 ============
const blenderBuildTool = defineTool({
	name: "blender_build",
	label: "Blender Build",
	description:
		"节点树结构操作：建/删/连/断节点、设值、建组边界接口。每次调用只用一个 action，各 action 用哪些参数见参数说明。\n" +
		"顺序：后端按 interface→add→add_item→set→link→unlink→del 执行，所以 set 先落地、link 后连；action=link 时可同时带 sets。\n" +
		"引用规则：节点一律用 name（Blender 唯一名，add 后返回的也是 name）；同 idname 多个节点也用 name 区分。\n" +
		"接口写法：照抄节点详情里接口行开头那个词（括号前）—— 节点组相关节点(GeometryNodeGroup / Group Input / Group Output)显示接口 name，写 Group.hi；其他节点显示 identifier，写 Merge by Distance.Distance。转换由脚本自动做，只有接口名在本节点重名时才需改用 identifier。\n" +
		"不确定接口先 node_find/node_full 查准再填。",
	parameters: Type.Object({
		action: Type.String({
			description: "七选一：add/del/link/unlink/set/interface/add_item",
		}),
		group: Type.String({
			description: "必填。要操作的目标节点组名（如 AI_Break）。组不存在时 add/set/link 会报错，需先 interface 建组。",
		}),
		ids: Type.Optional(Type.Array(Type.String(), {
			description: "action=add：要建的节点 idname，如 [\"GeometryNodeMeshCube\", \"GeometryNodeSetPosition\"]",
		})),
		nodes: Type.Optional(Type.Array(Type.String(), {
			description: "action=del：要删的节点 name 或唯一 idname",
		})),
		wires: Type.Optional(Type.Array(Type.String(), {
			description: "action=link/unlink：连线「节点name.接口 → 节点name.接口」，每个数组元素一条。"
				+ "接口名照抄节点详情（括号前那个词）。"
				+ "unlink：全式=断这根线；短式「节点.接口」只断该节点的输入线，输出侧必须用全式。",
		})),
		sets: Type.Optional(Type.Array(Type.Any(), {
			description: 'action=set（或 link 顺带）：[{"node":name,"prop":接口name或属性名,"value":值}]，node 填节点 name',
		})),
		ifs: Type.Optional(Type.Array(Type.Any(), {
			description: 'action=interface：[{"direction":"input/output","name":接口名,"socket_type":接口类型}]',
		})),
		items: Type.Optional(Type.Array(Type.Any(), {
			description: 'action=add_item：[{"zone":zone输出节点name,"socket_type":"Float/Vector/Geometry","item_name":状态名}]',
		})),
	}),
	async execute(_toolCallId, params) {
		return handleBuild(params);
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(blenderBuildTool);
}
