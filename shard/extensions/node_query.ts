/**
 * node_query 扩展 —— 节点查询（idname 是节点的唯一类型名）
 *
 * 薄前端：收参数 → 起 node_information 里的 python 脚本 → 原样返回。
 * 地址一律现读上一级的 py_environment.json；本文件不含任何绝对路径，可直接进 Git。
 */

import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { envFor, pyEnv, pythonOf, workspaceOf, SKILLS } from "../lib/env.ts";

const QRY = path.join(SKILLS, "node_information");

function errRes(text: string, extra?: Record<string, unknown>) {
	return { content: [{ type: "text", text }], details: { ok: false, ...extra }, isError: true };
}
function okRes(text: string, extra?: Record<string, unknown>) {
	return { content: [{ type: "text", text }], details: { ok: true, ...extra } };
}

// 统一校验：只排除控制字符
const ARG_RE = /^[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F]{1,200}$/;

function runPython(script: string, arg: string, env: any) {
	const PY = pythonOf(env);
	const WORK = workspaceOf(env);
	if (!arg || !ARG_RE.test(arg)) {
		return errRes(`ERROR: 非法参数 "${arg}"（含控制字符）`, { arg });
	}
	const res = spawnSync(PY, [path.join(QRY, script), arg], {
		encoding: "utf8",
		cwd: WORK,
		timeout: 60_000,
		env: pyEnv(env),
	});
	const stdout = (res.stdout ?? "").trim();
	const stderr = (res.stderr ?? "").trim();
	if (res.error) {
		return errRes(`python 启动失败：${String(res.error)}\n（用的 python：${PY}，来自 py_environment.json）`, { arg, stdout, stderr });
	}
	if (res.status !== 0) {
		return errRes(`${script} 失败(exit=${res.status ?? "?"}):\n${stdout || stderr || String(res.error || "")}`, { arg, stdout, stderr });
	}
	return okRes(stdout, { arg, stdout });
}

// 不知道节点叫什么名 → 用词找它的 idname
const nodeFindTool = defineTool({
	name: "node_find",
	label: "Node Find",
	description: "拿英文词(功能/名字)，找出对应的节点 idname。不知道节点确切 idname 时用",
	parameters: Type.Object({
		keyword: Type.String({ description: "英文搜索词，如 rounding / set position / color" }),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		return runPython("node_id_search.py", ((params.keyword ?? "") as string).trim(), envFor(ctx.cwd));
	},
});

// 拿到 idname → 直接返回这个节点的预生成精简 JSON
const nodeFullTool = defineTool({
	name: "node_full",
	label: "Node Full",
	description:
		"拿节点的 idname，直接返回它的预生成精简 JSON。\n" +
		"stdout 就是完整数据。重点看：\n" +
		"runtime_sockets（插口 identifier 和类型、enabled、默认值）、runtime_properties（可设属性名、默认值、枚举）、dynamic（切枚举后的插口变化）、supports（几何类型支持）。",
	parameters: Type.Object({
		idname: Type.String({ description: "节点 idname，如 GeometryNodeSetPosition" }),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		return runPython("node_full_export.py", ((params.idname ?? "") as string).trim(), envFor(ctx.cwd));
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(nodeFindTool);
	pi.registerTool(nodeFullTool);
}
