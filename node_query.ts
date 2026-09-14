/**
 * node_query 扩展 —— 节点查询（idname 是节点的唯一类型名）
 *
 * 薄前端：收参数 → 起 node_information 里的 python 脚本 → 原样返回。
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
const PY: string = ENV.python.exe; // 起 python 用
const WORK: string = ENV.workspace.root; // 工作区：python 的启动目录
const QRY = path.join(AGENT, "skills", "node_information");

// 统一校验：只排除控制字符
const ARG_RE = /^[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F]{1,200}$/;

function runPython(script: string, arg: string) {
	if (!arg || !ARG_RE.test(arg)) {
		return {
			content: [{ type: "text", text: `ERROR: 非法参数 "${arg}"（含控制字符）` }],
			details: { arg, ok: false },
			isError: true,
		};
	}
	const res = spawnSync(PY, [path.join(QRY, script), arg], {
		encoding: "utf8",
		cwd: WORK,
		timeout: 60_000,
		env: { ...process.env, PYTHONIOENCODING: "utf-8" },
	});
	const stdout = (res.stdout ?? "").trim();
	const stderr = (res.stderr ?? "").trim();
	if (res.error) {
		return {
			content: [
				{
					type: "text",
					text: `python 启动失败：${String(res.error)}\n（用的 python：${PY}，来自 py_environment.json）`,
				},
			],
			details: { arg, ok: false, stdout, stderr },
			isError: true,
		};
	}
	if (res.status !== 0) {
		return {
			content: [
				{
					type: "text",
					text: `${script} 失败(exit=${res.status ?? "?"}):\n${stdout || stderr || String(res.error || "")}`,
				},
			],
			details: { arg, ok: false, stdout, stderr },
			isError: true,
		};
	}
	return { content: [{ type: "text", text: stdout }], details: { arg, ok: true, stdout } };
}

// 不知道节点叫什么名 → 用词找它的 idname
const nodeFindTool = defineTool({
	name: "node_find",
	label: "Node Find",
	description: "拿英文词(功能/名字)，找出对应的节点 idname。不知道节点确切 idname 时用",
	parameters: Type.Object({
		keyword: Type.String({ description: "英文搜索词，如 rounding / set position / color" }),
	}),
	async execute(_toolCallId, params) {
		return runPython("node_id_search.py", (params.keyword ?? "").trim());
	},
});

// 拿到 idname → 直接返回这个节点的预生成精简 JSON
const nodeFullTool = defineTool({
	name: "node_full",
	label: "Node Full",
	description:
		"拿节点的 idname，直接返回它的预生成精简 JSON（半紧凑格式，已清洗脏数据）。\n" +
		"stdout 就是完整数据，不用再 read 文件。重点看：\n" +
		"runtime_sockets（插口 identifier 和类型、enabled、默认值）、runtime_properties（可设属性名、默认值、枚举）、dynamic（切枚举后的插口变化）、supports（几何类型支持）。",
	parameters: Type.Object({
		idname: Type.String({ description: "节点 idname，如 GeometryNodeSetPosition" }),
	}),
	async execute(_toolCallId, params) {
		return runPython("node_full_export.py", (params.idname ?? "").trim());
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(nodeFindTool);
	pi.registerTool(nodeFullTool);
}
