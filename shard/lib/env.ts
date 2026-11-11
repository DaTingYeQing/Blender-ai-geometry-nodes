/**
 * 共享地址解析 —— 所有扩展唯一的地址来源。
 *
 * 顺序：PI_ENV_JSON（安装版由 Electron 指向 userData 配置）或共享根的
 * py_environment.json 打底，再用当前项目的 <cwd>/.pi/py_environment.json 按段覆盖。
 * 扩展位于 <共享根>/extensions/，所以本文件放 <共享根>/lib/ 下。
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** 共享根：extensions/、skills/ 都在这里。 */
export const HOME = path.join(__dirname, "..");
const ENV_OVERRIDE = String(process.env.PI_ENV_JSON || "").trim();
export const ENV_JSON = ENV_OVERRIDE ? path.resolve(ENV_OVERRIDE) : path.join(HOME, "py_environment.json");
const ENV_DIR = path.dirname(ENV_JSON);
export const SKILLS = path.join(HOME, "skills");

export type Env = any;

function readJson(file: string): any {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (e) {
		throw new Error(`读不到地址簿 ${file}（${e}）。它是全部地址的唯一配置处，修好它再启动。`);
	}
}

/** 配置里的相对路径按地址簿所在目录解析。 */
function resolveEnvPath(value: unknown, baseDir?: string): string {
	const text = String(value ?? "").trim();
	if (!text) return "";
	return path.isAbsolute(text) ? text : path.resolve(baseDir || ENV_DIR, text);
}

/** 从 cwd 向上找项目的 .pi/py_environment.json（兼容从子目录启动）。 */
function findLocal(cwd: string): string | null {
	let p = path.resolve(cwd);
	for (let i = 0; i < 6; i++) {
		const cand = path.join(p, ".pi", "py_environment.json");
		if (path.resolve(cand) !== path.resolve(ENV_JSON) && fs.existsSync(cand)) return cand;
		const parent = path.dirname(p);
		if (parent === p) break;
		p = parent;
	}
	return null;
}

/** 共享地址簿 + 项目级覆盖（顶层按段浅合并，例如项目只写 workspace.root）。 */
export function envFor(cwd: string): Env {
	const base = readJson(ENV_JSON);
	base.__projectDir = path.resolve(cwd); // 项目根（Python 侧据此定位项目内文件）
	base.__envDir = ENV_DIR;
	const local = findLocal(cwd);
	if (!local) return base;

	const over = readJson(local);
	const merged: Env = { ...base };
	merged.__projectDir = path.dirname(path.dirname(local)); // <项目>/.pi/py_environment.json → <项目>
	merged.__envDir = path.dirname(local);
	for (const [key, value] of Object.entries(over)) {
		const prev = base[key];
		merged[key] =
			value && typeof value === "object" && !Array.isArray(value) &&
			prev && typeof prev === "object" && !Array.isArray(prev)
				? { ...prev, ...value }
				: value;
	}
	return merged;
}

export function pythonOf(env: Env): string {
	return resolveEnvPath(env?.python?.exe, env?.__envDir);
}

export function workspaceOf(env: Env): string {
	return resolveEnvPath(env?.workspace?.root, env?.__envDir);
}

/** 起 Python 时的统一环境：把共享地址簿、项目工作区、项目根显式传下去。 */
export function pyEnv(env: Env): Record<string, string | undefined> {
	return {
		...process.env,
		PYTHONIOENCODING: "utf-8",
		PI_ENV_JSON: ENV_JSON,
		PI_WORKSPACE_ROOT: workspaceOf(env),
		PI_PROJECT_DIR: env?.__projectDir ?? "",
	};
}
