/**
 * blender_screen 扩展 —— 只读查节点树（接口 / 连线 / 节点清单）
 *
 * 薄前端：收参数 → payload 写工作区 → 起 skills/execution/screen.py → 原样带回。
 * 找档、进 Blender、快照渲染全在后端 screen.py 里；查询只读不存盘（save=False）。
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
const WORK: string = ENV.workspace.root; // 工作区：payload / 快照都落这
const SCREEN = path.join(AGENT, "skills", "execution", "screen.py");
const PAYLOAD = path.join(WORK, "_screen_payload.json"); // payload 落工作区，不写 skill 目录

function errRes(text: string, extra?: Record<string, unknown>) {
	return { content: [{ type: "text", text }], details: { ok: false, ...extra }, isError: true };
}
function okRes(text: string, extra?: Record<string, unknown>) {
	return { content: [{ type: "text", text }], details: { ok: true, ...extra } };
}

/** 写 payload 到工作区并跑 screen.py。脚本只 print 一个 JSON；拿不到 JSON 才报 err。 */
function runScreen(payload: Record<string, unknown>) {
	try {
		fs.writeFileSync(PAYLOAD, JSON.stringify(payload, null, 2), "utf8");
	} catch (e) {
		return { err: `写 payload 失败: ${String((e as Error).message)}` };
	}
	const res = spawnSync(PY, [SCREEN, PAYLOAD], {
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

function handleScreen(params: Record<string, unknown>) {
	const group = ((params.group as string) ?? "").trim();
	if (!group) return errRes("ERROR: 必须指定 group（要查的节点组名，如 AI_Break）");
	const detail = ((params.detail as string) ?? "detail").trim() || "detail";
	if (detail !== "overview" && detail !== "detail") {
		return errRes(`ERROR: detail 只能是 overview 或 detail，当前 "${detail}"`);
	}
	const nodes = Array.isArray(params.nodes) ? params.nodes.map(String).filter(Boolean) : [];

	const r = runScreen({ tree: group, detail, nodes: nodes.length ? nodes : undefined, workdir: WORK });
	if (r.err) return errRes(r.err);
	const d = r.data;
	if (!d?.ok) {
		return errRes(`[screen] 查询失败：${d?.error ?? "未知错误"}`, { channel: d?.channel });
	}
	return okRes(String(d.text ?? ""), {
		tree: d.tree, node_count: d.node_count, matched: d.matched, screen: d.screen_json,
	});
}

// ============ 工具定义 ============
const blenderScreenTool = defineTool({
	name: "blender_screen",
	label: "Blender Screen",
	description:
		"只读查节点树（不改档、不存盘，自动读工作档）。\n" +
		"  group: 必填，指定要查的节点组名（如 AI_Break）\n" +
		"  overview: 返回全节点清单(idname/name)，字符量小，先看整个树有哪些节点\n" +
		"  detail(默认): 返回指定节点的全部接口+每根线连到哪；需 nodes 参数\n" +
		"示例:\n" +
		"  group=AI_Break detail=overview\n" +
		"  group=AI_Break detail=detail nodes=[\"GeometryNodeMeshCube\"]\n" +
		"  group=AI_Break detail=detail nodes=[\"GeometryNodeMeshCube\",\"GeometryNodeSetPosition\"]\n" +
		"nodes 里每条是 name（Blender 唯一名）或 idname（支持子串模糊）；同 idname 多个时用 name 区分。改树用 blender_build。\n" +
		"工作档: 自动读工作区 workflow_state.json 里的唯一工作档；还没建档(wf_plan)时会报错——先建档再查。",
	parameters: Type.Object({
		group: Type.String({
			description: "必填。要查的节点组名（如 AI_Break）。改树用 blender_build 的 group。",
		}),
		detail: Type.Optional(Type.String({
			description: "overview | detail(默认)",
		})),
		nodes: Type.Optional(Type.Array(Type.String(), {
			description: "detail 模式必填：节点 name 或 idname 数组，如 [\"Cube\",\"GeometryNodeSetPosition\"]；idname 支持子串模糊。同 idname 多个时用 name 区分",
		})),
	}),
	async execute(_toolCallId, params) {
		return handleScreen(params);
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(blenderScreenTool);
}
