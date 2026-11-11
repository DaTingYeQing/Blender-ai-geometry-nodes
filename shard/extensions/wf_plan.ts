/**
 * wf_plan 扩展 —— 任务计划工具
 *
 * AI 查完节点后调用: 提交项目名 + 模块拆解(每个模块的节点 idname 清单)。
 * 落盘 workflow_state.json(计划 + 执行状态合一: project / modules / cur / phase)：
 * Pi Flow 内落本次 run 的 output；终端模式落工作区。
 * 建档(建空档 + 写 state)是本工具的活; 读档/存档由 blender_channel 自理, 其他工具不碰。
 * 地址一律现读上一级的 py_environment.json；本文件不含任何绝对路径，可直接进 Git。
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { envFor, pyEnv, pythonOf, workspaceOf, SKILLS } from "../lib/env.ts";

const CHANNEL = path.join(SKILLS, "execution", "blender_channel.py");

// idname 安全校验
const IDNAME_RE = /^[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F]{1,200}$/;

/** 在本次 run 的 output 里创建空档 <项目名>.blend（经 blender_channel 开空场景并存盘），返回绝对路径 */
function createWorkBlend(project: string, env: any, outDir: string): { path: string; err?: string } {
	const PY = pythonOf(env);
	const blend = path.join(outDir, project + ".blend");
	const res = spawnSync(PY, [CHANNEL, "-e", "pass", "--read=new", `--save=${blend}`], {
		encoding: "utf8",
		cwd: outDir,
		timeout: 150_000, // 略高于 channel 内部默认 120s，让它的文案先说话
		env: pyEnv(env),
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
		"出任务计划。输入项目名 + 模块拆解(每模块：名称 + 涉及的节点 idname 清单)，" +
		"落盘 workflow_state.json(Pi Flow 内到本次 run 的 output，终端模式到工作区；计划+执行状态合一, 后续按模块逐个实现)。\n" +
		"project 会用来建工作档 <project>.blend；模块数量没有限制，按任务实际拆。\n" +
		"调用前必须先查过节点(先用 node_find / node_full)。",
	parameters: Type.Object({
		project: Type.String({
			description: "项目名。会作为工作档文件名 <项目名>.blend，所以别带 \\ / : * ? \" < > | 这些 Windows 文件名非法字符，用短代号如 AI_Shard_Main",
		}),
		modules: Type.Array(
			Type.Object({
				name: Type.String({ description: "模块名, 如 距离计算" }),
				idnames: Type.Array(
					Type.String({ description: "该模块涉及的节点 idname 清单, 如 GeometryNodeVoronoiTexture" }),
				),
			}),
		),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const env = envFor(ctx.cwd);
		const OUT = String(process.env.PI_FLOW_OUTPUT_DIR || "").trim() || workspaceOf(env);
		const project = (params.project ?? "").trim();
		const modules = (params.modules ?? []) as Array<{ name: string; idnames: string[] }>;

		if (!OUT) {
			return {
				content: [
					{
						type: "text",
						text: "ERROR: 找不到输出目录（Pi Flow 需要 PI_FLOW_OUTPUT_DIR，终端模式需要 workspace.root）",
					},
				],
				details: { ok: false },
				isError: true,
			};
		}
		if (!project) {
			return {
				content: [{ type: "text", text: "ERROR: 缺少 project(项目名)" }],
				details: { ok: false },
				isError: true,
			};
		}
		if (/[\\/:*?"<>|]/.test(project)) {
			return {
				content: [{ type: "text", text: `ERROR: project 含非法文件名字符："${project}"` }],
				details: { ok: false },
				isError: true,
			};
		}
		fs.mkdirSync(OUT, { recursive: true });
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
		const { path: blendPath, err: blendErr } = createWorkBlend(project, env, OUT);
		if (blendErr) {
			return {
				content: [{ type: "text", text: `ERROR: ${blendErr}` }],
				details: { ok: false },
				isError: true,
			};
		}

		// 落盘 workflow_state.json(计划+状态合一+唯一工作档路径)，固定落本次 run 的 output
		const state = {
			project,
			blend: blendPath, // 唯一工作档：所有构建/执行都固定读写此档
			flowId: process.env.PI_FLOW_FLOW_ID ?? null,
			runId: process.env.PI_FLOW_RUN_ID ?? null,
			modules: modules.map((m, i) => ({ id: i + 1, name: m.name, idnames: m.idnames, status: "pending" })),
			cur: 0,
			phase: "build",
		};
		const statePath = path.join(OUT, "workflow_state.json");
		fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");

		return {
			content: [
				{
					type: "text",
					text:
						`== wf_plan ${project} ==\n` +
						`工作档已自动创建并锁定: ${blendPath}\n` +
						`节点树组织规范(名字由你 AI 自己定）主线节点树挂在这个物体的几何节点修改器上\n` +
						`模块: ${counts.join(" + ")}\n` +
						`输出目录: ${OUT}\n` +
						`workflow_state.json 落盘。执行阶段: 按模块逐个实现, 文件在 ${blendPath} 上; 打勾推进模块(cur+1, status="done")`,
				},
			],
			details: { project, modules: modules.length, path: statePath, blend: blendPath },
		};
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(wfPlanTool);
}
