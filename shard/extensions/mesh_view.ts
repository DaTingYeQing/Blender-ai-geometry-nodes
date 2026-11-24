/**
 * mesh_view 扩展 —— 打开网格脚本的交互预览窗口
 *
 * 只做一件事：把脚本丢给 meshkit.viewer，开一个 pyvista 窗口就返回。
 * 窗口是独立进程，工具调用结束、agent 继续跑都不影响它；用户关掉窗口它才退出。
 *
 * 脚本要求与 meshkit.stage 一致：模块级 SCHEMA + STAGES，入口 build(**params, stage=None)。
 * 控件由 SCHEMA 自动生成，拖滑块 = 全量重跑 build，参数初值用 SCHEMA 的 default。
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { HOME, envFor, pyEnv, pythonOf, workspaceOf } from "../lib/env.ts";

const SERVICE_MODULE = "meshkit.viewer";

function errRes(text: string, extra?: Record<string, unknown>) {
	return { content: [{ type: "text", text }], details: { ok: false, ...extra }, isError: true };
}
function okRes(text: string, extra?: Record<string, unknown>) {
	return { content: [{ type: "text", text }], details: { ok: true, ...extra } };
}

function str(v: unknown): string {
	return v === undefined || v === null ? "" : String(v).trim();
}

function resolveScript(raw: unknown, cwd: string, work: string): string | { err: string } {
	const text = str(raw);
	if (!text) return { err: "ERROR: 需要 script（要预览的 .py 路径）" };
	const candidates = path.isAbsolute(text)
		? [text]
		: [path.resolve(cwd, text), path.resolve(work, text)];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
	}
	return { err: `ERROR: 找不到脚本 ${text}\n试过：\n${candidates.join("\n")}` };
}

function folderName(stem: string): string {
	return stem.replace(/[\\/:*?"<>|]/g, "_").trim() || "mesh";
}

/** 等一小会儿看进程是否立刻退出；立刻退出说明窗口没起来。 */
function settle(child: ReturnType<typeof spawn>, ms: number): Promise<boolean> {
	return new Promise((resolve) => {
		const done = () => resolve(child.exitCode !== null || child.signalCode !== null);
		child.once("exit", () => resolve(true));
		child.once("error", () => resolve(true));
		setTimeout(() => resolve(done()), ms);
	});
}

function readLog(file: string): string {
	try {
		return fs.readFileSync(file, "utf8").trim().slice(0, 1600);
	} catch {
		return "";
	}
}

async function handleView(params: Record<string, unknown>, env: any, cwd: string) {
	const PY = pythonOf(env);
	const WORK = workspaceOf(env);
	const found = resolveScript(params.script, cwd, WORK);
	if (typeof found !== "string") return errRes(found.err);
	const script = found;

	const stem = path.basename(script, path.extname(script));
	const outDir = path.join(WORK, folderName(stem));
	fs.mkdirSync(outDir, { recursive: true });

	const payloadPath = path.join(outDir, "view.json");
	const logPath = path.join(outDir, "viewer.log");
	const extra = { script, payload: payloadPath, log: logPath };

	try {
		fs.writeFileSync(
			payloadPath,
			JSON.stringify({ script, log_path: logPath }, null, 2),
			"utf8",
		);
	} catch (e) {
		return errRes(`写 payload 失败：${String((e as Error).message)}`, extra);
	}
	try {
		fs.unlinkSync(logPath);
	} catch {
		// 上一次的日志，删不掉就算了
	}

	let child: ReturnType<typeof spawn>;
	try {
		child = spawn(PY, ["-u", "-m", SERVICE_MODULE, payloadPath], {
			cwd: HOME, // -m 需要从 shard/ 找 meshkit 包
			env: pyEnv(env),
			detached: true, // 独立进程组：本工具返回、agent 退出都不带走它
			stdio: "ignore",
			windowsHide: false,
		});
		child.unref();
	} catch (e) {
		return errRes(`python 启动失败：${String((e as Error).message)}`, extra);
	}

	if (!PY) return errRes("python.exe 没有配置（py_environment.json 的 python.exe）", extra);
	if (await settle(child, 1500)) {
		const detail = readLog(logPath);
		return errRes(
			`窗口没起来（exit=${child.exitCode ?? "?"}）${detail ? `：\n${detail}` : "，没有日志。"}`,
			extra,
		);
	}

	return okRes(
		[
			`[mesh_view] 已打开 ${stem} 的预览窗口`,
			`  脚本：${script}`,
			`  控件：SCHEMA 的 default 作为初值，拖滑块全量重建`,
			`  日志：${logPath}`,
			"  （窗口独立运行，关掉窗口即退出）",
		].join("\n"),
		{ ...extra, pid: child.pid },
	);
}

// ============ 工具定义 ============
const meshViewTool = defineTool({
	name: "mesh_view",
	label: "Mesh View",
	description:
		"打开网格脚本的交互预览窗口（pyvista 滑块面板）：自动按 SCHEMA 生成控件，拖参数全量重跑 build。\n" +
		"窗口是独立进程，调用立刻返回，不占用 agent；用户关掉窗口才退出。\n" +
		"脚本要求：模块级 SCHEMA + STAGES，入口 build(**params, stage=None)；参数初值用 SCHEMA 的 default。",
	parameters: Type.Object({
		script: Type.String({
			description: "要预览的 .py 路径（绝对路径，或相对当前目录/工作区）；只需这一个参数",
		}),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		return handleView(params, envFor(ctx.cwd), ctx.cwd);
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(meshViewTool);
}
