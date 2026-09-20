/**
 * wf_plan 扩展 —— 任务计划工具
 *
 * AI 查完节点后调用: 提交项目名 + 模块拆解(每个模块的节点 idname 清单)。
 * 落盘 workflow_state.json(计划 + 执行状态合一: project / modules / cur / phase) —— 固定落在工作区。
 * 建档(建空档 + 写 state)是本工具的活; 读档/存档由 blender_channel 自理, 其他工具不碰。
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
const WORK: string = ENV.workspace.root; // 工作区：工作档和 workflow_state.json 都落这
const CHANNEL = path.join(AGENT, "skills", "execution", "blender_channel.py");

// idname 安全校验
const IDNAME_RE = /^[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F]{1,200}$/;

/** 在工作区真正创建一个空档 <项目名>.blend（经 blender_channel 开空场景并存盘），返回绝对路径 */
function createWorkBlend(project: string): { path: string; err?: string } {
	const blend = path.join(WORK, project + ".blend");
	const res = spawnSync(PY, [CHANNEL, "-e", "pass", "--read=new", `--save=${blend}`], {
		encoding: "utf8",
		cwd: WORK,
		timeout: 150_000, // 略高于 channel 内部默认 120s，让它的文案先说话
		env: { ...process.env, PYTHONIOENCODING: "utf-8" },
	});
	const stdout = (res.stdout ?? "").trim();
	const stderr = (res.stderr ?? "").trim();
	if (res.error) {
		return {
			path: blend,
			err: `python 启动失败：${String(res.error)}\n（用的 python：${PY}，来自 py_environment.json）`,
		};
	}
	if (res.status !== 0) {
		return { path: blend, err: `创建空档失败(exit=${res.status ?? "?"}):\n${stdout || stderr || String(res.error || "")}` };
	}
	return { path: blend };
}

const wfPlanTool = defineTool({
	name: "wf_plan",
	label: "Workflow Plan",
	description:
		"出任务计划(最后一个动作前的必做步骤)。输入项目名 + 模块拆解(每个模块的节点 idname 清单), " +
		"落盘 workflow_state.json(计划+执行状态合一, 后续按模块逐个实现)。\n" +
		"调用前必须先查过节点(先用 node_find / node_full)。",
	parameters: Type.Object({
		project: Type.String({ description: "项目名" }),
		modules: Type.Array(
			Type.Object({
				name: Type.String({ description: "模块名, 如 距离计算" }),
				idnames: Type.Array(
					Type.String({ description: "该模块涉及的节点 idname 清单, 如 GeometryNodeVoronoiTexture" }),
				),
			}),
		),
	}),
	async execute(_toolCallId, params) {
		const project = (params.project ?? "").trim();
		const modules = (params.modules ?? []) as Array<{ name: string; idnames: string[] }>;

		if (!project) {
			return {
				content: [{ type: "text", text: "ERROR: 缺少 project(项目名)" }],
				details: { ok: false },
				isError: true,
			};
		}
		if (!modules.length) {
			return {
				content: [{ type: "text", text: "ERROR: modules 为空 —— 至少拆 1 个模块, 每个模块带 idnames 清单" }],
				details: { ok: false },
				isError: true,
			};
		}

		// 校验 idname 并统计各模块节点
		const counts: string[] = [];
		for (const m of modules) {
			for (const id of m.idnames) {
				if (!IDNAME_RE.test(id)) {
					return {
						content: [
							{ type: "text", text: `ERROR: 非法 idname "${id}"（含控制字符）` },
						],
						details: { ok: false },
						isError: true,
					};
				}
			}
			counts.push(`${m.name}(${m.idnames.length})`);
		}

		// 自动创建唯一工作档 <项目名>.blend（全程固定此档，AI 不再传 read/save）
		const { path: blendPath, err: blendErr } = createWorkBlend(project);
		if (blendErr) {
			return {
				content: [{ type: "text", text: `ERROR: ${blendErr}` }],
				details: { ok: false },
				isError: true,
			};
		}

		// 落盘 workflow_state.json(计划+状态合一+唯一工作档路径)，固定落工作区
		const state = {
			project,
			blend: blendPath, // 唯一工作档：所有构建/执行都固定读写此档
			modules: modules.map((m, i) => ({ id: i + 1, name: m.name, idnames: m.idnames, status: "pending" })),
			cur: 0,
			phase: "build",
		};
		const statePath = path.join(WORK, "workflow_state.json");
		fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");

		return {
			content: [
				{
					type: "text",
					text:
						`== wf_plan ${project} ==\n` +
						`工作档已自动创建并锁定: ${blendPath}\n` +
						`节点树组织规范(名字由你 AI 自己定，不必按 M 编号), 一个项目只有一个物体; 主线节点树挂在这个物体的几何节点修改器上。需要小测试时: 新建一棵临时节点树, 临时把修改器的 node_group 指向它\n` +
						`模块: ${counts.join(" + ")}\n` +
						`workflow_state.json 已落盘(工作区)。现在进入执行阶段: 按模块逐个实现, 全部构建都落在工作档 ${blendPath} 上; 每完成一个模块打勾推进(cur+1, status="done")`,
				},
			],
			details: { project, modules: modules.length, path: statePath, blend: blendPath },
		};
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(wfPlanTool);
}
