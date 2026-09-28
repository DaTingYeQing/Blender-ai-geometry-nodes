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

// ============ 结构化连线 → 后端字符串 ============
// 后端 _refs.parse_wire 接受 "节点.接口 to 节点.接口"（to/→/-> 都认）。
// AI 只填四个字段，点号和连接词由这里拼——AI 永远不用碰格式。
type LinkRow = {
	from_node?: unknown; from_socket?: unknown;
	to_node?: unknown; to_socket?: unknown;
};

/** 一条结构化连线 → "A.b to C.d"。缺关键字段返回 err。 */
function linkToString(w: LinkRow, what: string): string | { err: string } {
	const fn = String(w?.from_node ?? "").trim();
	const fs = String(w?.from_socket ?? "").trim();
	const tn = String(w?.to_node ?? "").trim();
	const ts = String(w?.to_socket ?? "").trim();
	if (!fn || !fs || !tn || !ts) {
		return { err: `ERROR: ${what} 每项需要 from_node / from_socket / to_node / to_socket 四个字段，如 `
			+ '{"from_node":"Cube","from_socket":"Mesh","to_node":"Set Position","to_socket":"Geometry"}' };
	}
	return `${fn}.${fs} to ${tn}.${ts}`;
}

/** 连线数组归一化：读结构化 links，拼成后端认的串。 */
function toWires(p: Record<string, unknown>, what: string): string[] | { err: string } {
	const rows = Array.isArray(p.links) ? p.links : [];
	if (!rows.length) return { err: `ERROR: ${what} 需要 links` };
	const out: string[] = [];
	for (const row of rows) {
		const s = linkToString(row as LinkRow, what);
		if (typeof s !== "string") return s;
		out.push(s);
	}
	return out;
}

/** 断线数组归一化：读结构化 breaks（可短式）。 */
function toBreaks(p: Record<string, unknown>): string[] | { err: string } {
	const rows = Array.isArray(p.breaks) ? p.breaks : [];
	if (!rows.length) return { err: "ERROR: action=unlink 需要 breaks" };
	const out: string[] = [];
	for (const row of rows) {
		const r = row as LinkRow;
		const tn = String(r?.to_node ?? "").trim();
		const ts = String(r?.to_socket ?? "").trim();
		const fn = String(r?.from_node ?? "").trim();
		const fs = String(r?.from_socket ?? "").trim();
		if (fn && fs && tn && ts) {
			// 全式：有起点四件套 → 断这一根线
			out.push(`${fn}.${fs} to ${tn}.${ts}`);
		} else if (tn && ts && !fn && !fs) {
			// 短式：只给终点 → 断该节点这个输入上的线
			out.push(`${tn}.${ts}`);
		} else {
			return { err: 'ERROR: action=unlink 的 breaks 每项要么给全四个字段（断一根线），'
				+ '要么只给 to_node + to_socket（断该输入上的线），如 '
				+ '{"to_node":"Set Position","to_socket":"Geometry"}' };
		}
	}
	return out;
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
		const wires = toWires(p, "action=link 的 links");
		if (!Array.isArray(wires)) return wires;
		const batch: Batch = { link: wires };
		if (Array.isArray(p.sets) && p.sets.length) batch.set = p.sets; // link 可顺带 set（后端顺序 set 在 link 之前）
		return batch;
	},
	unlink: (p) => {
		const wires = toBreaks(p);
		return Array.isArray(wires) ? { unlink: wires } : wires;
	},
	set: (p) => {
		const sets = needObjs(p.sets, 'action=set 需要 sets：[{"node":name,"socket":接口名,"value":值}]');
		if (!Array.isArray(sets)) return sets;
		// socket（设接口默认值）与 prop（改节点属性）二选一：前端先拦，别等 Blender
		for (const s of sets) {
			const row = (s ?? {}) as Record<string, unknown>;
			const hasSock = String(row.socket ?? "").trim() !== "";
			const hasProp = String(row.prop ?? "").trim() !== "";
			if (hasSock && hasProp) {
				return { err: "ERROR: sets 每项的 socket 与 prop 只能填一个：设接口默认值用 socket，改节点属性用 prop" };
			}
			if (!hasSock && !hasProp) {
				return { err: 'ERROR: sets 每项要填 socket（接口名）或 prop（属性名）之一，如 {"node":"Math","socket":"Value_001","value":2}' };
			}
		}
		const batch: Batch = { set: sets };
		// set 可顺带连线（后端顺序 set 在 link 之前）
		if (Array.isArray(p.links) && p.links.length) {
			const wires = toWires(p, "action=set 的 links");
			if (!Array.isArray(wires)) return wires;
			batch.link = wires;
		}
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
		return errRes(`ERROR: action 必须是以下之一：${Object.keys(ACTIONS).join("/")}`);
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
		"所有参数都按字段填。\n" +
		"引用规则：节点一律用 name；同 idname 多个节点也用 name 区分。\n" +
		"不确定接口先 node_find/node_full 查准再填。",
	parameters: Type.Object({
		action: Type.Union([
			Type.Literal("add"), Type.Literal("del"),
			Type.Literal("link"), Type.Literal("unlink"),
			Type.Literal("set"), Type.Literal("interface"),
			Type.Literal("add_item"),
		], {
			description: "本次要做的操作。add=建节点 / del=删节点 / link=连线 / unlink=断线 / set=设值或改属性 / interface=建组边界接口 / add_item=给 zone 加携带项",
		}),
		group: Type.String({
			description: "必填。节点组名。组不存在时 add / interface 都会自动新建一个空组；add 建出的树没有 Group Input/Output，interface 建的树自带。",
		}),
		ids: Type.Optional(Type.Array(Type.String(), {
			description: "action=add：要建的节点 idname",
		})),
		nodes: Type.Optional(Type.Array(Type.String(), {
			description: "action=del：要删的节点 name 或唯一 idname",
		})),
		links: Type.Optional(Type.Array(Type.Object({
			from_node: Type.String({ description: "起点节点 name" }),
			from_socket: Type.String({ description: "起点节点的输出接口名" }),
			to_node: Type.String({ description: "终点节点 name" }),
			to_socket: Type.String({ description: "终点节点的输入接口名" }),
		}), {
			description: "action=link：要连的线，四个字段都填。",
		})),
		breaks: Type.Optional(Type.Array(Type.Object({
			from_node: Type.Optional(Type.String({ description: "断整根线时填：起点节点 name" })),
			from_socket: Type.Optional(Type.String({ description: "断整根线时填：起点输出接口名" })),
			to_node: Type.String({ description: "终点节点 name（只断一个输入时也填这个）" }),
			to_socket: Type.String({ description: "终点输入接口名" }),
		}), {
			description: "action=unlink：要断的线。四个字段都填 = 断这一根线；"
				+ "只填 to_node + to_socket = 断该输入上的线。",
		})),
		sets: Type.Optional(Type.Array(Type.Object({
			node: Type.String({ description: "节点 name（也可填 Group Input / Group Output）" }),
			socket: Type.Optional(Type.String({
				description: "设接口默认值时填：接口名（name 或 identifier），与 prop 二选一。"
					+ "同名接口重名时必须写 identifier。"
					+ "node 是 Group Input / Group Output 时，这里写组接口名，改的是组接口默认值。",
			})),
			prop: Type.Optional(Type.String({
				description: "改节点属性时填：属性名（如 operation / data_type），与 socket 二选一；枚举写大写 id。",
			})),
			value: Type.Any({ description: "要设的值：数字 / 布尔 / 数组 / 字符串，按该接口或属性的类型给" }),
		}), {
			description: "action=set：改一个值，每条一个对象。"
				+ "socket 与 prop 二选一：设接口默认值用 socket，改节点属性用 prop；都填会报错。",
		})),
		ifs: Type.Optional(Type.Array(Type.Object({
			direction: Type.String({ description: "input 或 output" }),
			name: Type.String({ description: "接口名" }),
			socket_type: Type.String({ description: "接口类型名，大小写不限" }),
		}), {
			description: "action=interface：建组边界接口，每条一个对象。",
		})),
		items: Type.Optional(Type.Array(Type.Object({
			zone: Type.String({ description: "zone 输出节点的 name" }),
			socket_type: Type.String({ description: "类型名：Float / Vector / Geometry" }),
			item_name: Type.String({ description: "状态名（携带项的名字）" }),
		}), {
			description: "action=add_item：给 zone 输出节点加携带项，每条一个对象。",
		})),
	}),
	async execute(_toolCallId, params) {
		return handleBuild(params);
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(blenderBuildTool);
}
