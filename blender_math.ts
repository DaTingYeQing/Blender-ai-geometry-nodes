/**
 * blender_math 扩展 —— 傻瓜式写数学表达式 → 自动建 Blender 数学节点组
 *
 * 薄前端：收参数 → payload 写工作区 → 起 skills/execution 的数学脚本 → 原样带回。
 *   eval ：math_eval.py 纯 Python 试算（与 Blender 同一条语义路径），不碰 Blender；
 *   build：math_compile.py 一条龙——编译、生成建节点脚本、经同目录 blender_channel
 *          进 Blender 建组，并按工作区 workflow_state.json 里的工作档自动读/存。
 *          本文件不碰 blender.exe，也不自己读工作档。
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
const WORK: string = ENV.workspace.root; // 工作区：payload / 生成脚本 / 工作档都在这
const MATH_DIR = path.join(AGENT, "skills", "execution"); // 数学套件正式位置
const PAYLOAD = path.join(WORK, "math_payload.json"); // payload 落工作区，不写 skill 目录

function errRes(text: string, extra?: Record<string, unknown>) {
	return { content: [{ type: "text", text }], details: { ok: false, ...extra }, isError: true };
}
function okRes(text: string, extra?: Record<string, unknown>) {
	return { content: [{ type: "text", text }], details: { ok: true, ...extra } };
}

/**
 * 写 payload 到工作区并跑一个数学脚本。脚本只 print 一个 JSON：
 * 能解析出 JSON 就返回它（业务失败也是 ok:false 的 JSON，原样交给调用方格式化）；
 * 连 JSON 都没有（python 崩了 / 启动失败）才报 err。
 */
function runMath(script: string, payload: Record<string, unknown>, timeout: number) {
	try {
		fs.writeFileSync(PAYLOAD, JSON.stringify(payload, null, 2), "utf8");
	} catch (e) {
		return { err: `写 payload 失败: ${String((e as Error).message)}` };
	}
	const res = spawnSync(PY, [path.join(MATH_DIR, script), PAYLOAD], {
		encoding: "utf8",
		cwd: WORK,
		timeout,
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
	return { data, stderr };
}

function handleMath(params: Record<string, unknown>) {
	const action = ((params.action as string) ?? "").trim();
	if (action !== "eval" && action !== "build") {
		return errRes("ERROR: 必须指定 action: eval(算数值) 或 build(编译建节点)");
	}
	const expr = ((params.expr as string) ?? "").trim();
	if (!expr) return errRes("ERROR: 需要 expr(数学表达式)，如 sin(x) * 2 + y");

	// inputs 只在前端做形状校验；group / node_name / 表达式的校验全在后端（报错会讲清怎么改）
	const inputs = params.inputs;
	let inputsRows: unknown[] | undefined;
	if (inputs !== undefined && inputs !== null && inputs !== "") {
		if (!Array.isArray(inputs)) {
			return errRes('ERROR: inputs 必须是 JSON 数组，如 [{"x": 0.5, "y": 1.0}]');
		}
		inputsRows = inputs;
	}

	const payload: Record<string, unknown> = {
		type: ((params.type as string) ?? "").trim() || "math",
		expr,
		inputs: inputsRows,
	};

	// ---- eval：只算数值（纯 Python，不碰 Blender）----
	if (action === "eval") {
		const r = runMath("math_eval.py", payload, 60_000);
		if (r.err) return errRes(r.err);
		const d = r.data;
		// 结构性失败（缺输入 / 表达式非法 / 类型检查不过）：有 error 无 results
		if (d.error) return errRes(`校验/求值失败：${d.error}`);
		const typeName = d.mode === "vector_math" ? "矢量" : "标量";
		const lines = [
			`[math eval] ${typeName} 表达式求值成功，输出类型=${d.output_type}，变量=${JSON.stringify(d.types)}`,
		];
		for (const row of d.results ?? []) {
			lines.push(`  输入 ${JSON.stringify(row.input)} -> 结果 ${JSON.stringify(row.result)}`);
		}
		// 部分行求值报错：结果照常展示，但整体标失败，别把半截结果当成功
		if (d.errors?.length) {
			lines.push("  部分行报错:");
			for (const e of d.errors) lines.push(`    ${JSON.stringify(e)}`);
			return errRes(lines.join("\n"), { results: d.results, errors: d.errors });
		}
		return okRes(lines.join("\n"), { output_type: d.output_type, types: d.types, results: d.results });
	}

	// ---- build：编译 + 进 Blender 建节点（math_compile 一条龙）----
	payload.group = ((params.group as string) ?? "").trim(); // 空则后端报错（文案会说清怎么填）
	payload.node_name = ((params.node_name as string) ?? "").trim();
	if (params.types !== undefined && params.types !== null && params.types !== "") {
		payload.types = params.types; // 显式类型（如 {"x":"Float"}），优先级高于 inputs 推断
	}
	payload.out_dir = WORK; // 生成脚本 / 结构 JSON 落工作区
	payload.workdir = WORK; // 去这儿找 workflow_state.json 定工作档（找到就建完存回）
	const r = runMath("math_compile.py", payload, 150_000); // 后端内含 Blender 默认 120s，略加大罩住
	if (r.err) return errRes(r.err);
	const d = r.data;
	if (!d?.ok) {
		return errRes(`编译/建节点失败：${d?.error ?? "未知错误"}`, { blender: d?.blender });
	}
	const vars: string[] = d.input_vars ?? [];
	const lines = [
		`[math build] ✓ 成功：主组 "${d.group}" 里已建好节点 "${d.node_name_actual}"`,
		`  输入接口: ${vars.join(", ") || "(无变量)"}     输出接口: ${d.output_var}`,
	];
	if (d.node_name_warn) lines.push(`  ⚠ ${d.node_name_warn}`);
	if (d.note) lines.push(`  ${d.note}`); // 存盘情况（存到哪个档 / 未存盘的原因）
	return okRes(lines.join("\n"), {
		group: d.group, tree: d.tree, node_name: d.node_name_actual,
		inputs: vars, output: d.output_var, output_type: d.output_type,
		saved: d.saved_to_disk, script: d.script, struct: d.struct,
	});
}

// ============ 工具定义 ============
const blenderMathTool = defineTool({
	name: "blender_math",
	label: "Blender Math",
	description:
		"把数学表达式编译成 Blender 数学节点组（自动建节点，不用手摆 Math/Vector Math）。\n" +
		"用法：先 action=eval 用纯 Python 试算（与 Blender 同语义）确认公式，再 action=build 进 Blender 建出来。\n" +
		"expr 直接写数学式子（sin(x) * 2 + y、sqrt(abs(x))、dot(a, b) + length(c)），不是 Python 表达式；标量用 type=math，矢量用 type=vector_math（标量*矢量自动转 SCALE）。\n" +
		"变量会自动建组输入接口、结果自动连组输出，顺序按变量在表达式里出现的先后（length(hi - lo) * precision → Socket_0=hi, Socket_1=lo, Socket_2=precision）。\n" +
		"数学节点封装在一个子组里，指定的 group 中会自动放一个引用它的 Group 节点（node_tree 已绑好，不用自己 add GeometryNodeGroup）；它在主组里的 name = 你填的 node_name（重名会变 xxx.001，以返回的 node_name 为准），输入/输出要自己用 blender_build 连。",
	parameters: Type.Object({
		action: Type.String({
			description: "eval(先算数值验证公式) 或 build(编译并进 Blender 建出节点组)",
		}),
		type: Type.Optional(Type.String({
			description: "表达式类型: math(标量) 或 vector_math(矢量)。默认 math。",
		})),
		expr: Type.String({
			description: "数学表达式，自然写法如 sin(x) * 2 + y、dot(a, b) + length(c)。"
				+ "eval 和 build 都要填（两次调用之间无状态，build 必须把同一个表达式再填一次）。",
		}),
		inputs: Type.Optional(Type.Array(Type.Any(), {
			description: '输入值数组，如 [{"x": 0.5, "y": 1.0}]。eval 必填；build 用于类型推断（或改用 types 显式指定）。',
		})),
		types: Type.Optional(Type.Record(Type.String(), Type.String(), {
			description: 'action=build 可选：显式指定变量类型，如 {"x":"Float","v":"Vector"}。优先级高于 inputs 推断，给了它 build 就不用抄 inputs。',
		})),
		group: Type.Optional(Type.String({
			description: "action=build 必填：要在哪个节点组里建数学节点（不存在会自动新建）。不指定则 build 报错。",
		})),
		node_name: Type.Optional(Type.String({
			description: "action=build 必填（eval 不用填）：主组里那个数学节点的 name，自己起个短代号，如 delta / rot_axis / size_ratio。"
				+ "禁止含逗号、→、->、换行；≤ 63 字节（中文 1 字 = 3 字节）。"
				+ "同一主组里重名时 Blender 会自动改成 xxx.001，实际名以返回值为准。",
		})),
	}),
	async execute(_toolCallId, params) {
		return handleMath(params);
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(blenderMathTool);
}
