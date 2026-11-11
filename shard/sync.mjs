#!/usr/bin/env node
/**
 * sync.mjs —— 按 shard/agents.json 维护各项目 agent 的工具清单。
 *
 *   node sync.mjs init [--force] [--dry-run]      # 扫描现状，生成 agents.json
 *   node sync.mjs check [项目...]                  # 只比对，有漂移退出码 1
 *   node sync.mjs sync  [项目...] [--dry-run]      # 写入各项目 .pi/settings.json / py_environment.json
 *
 * 只管理指向本目录 extensions/ 的条目；项目的 skills/（SKILL.md 文本）完全由人手动放，
 * 脚本也不碰。项目里其它扩展条目（如 subagent 的占位 + 排除对）原样保留。
 * 改完需重启 pi 或 /reload 才生效。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOME = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HOME, "agents.json");
const TOOLS_DIR = join(HOME, "extensions");
// 安装版把模板复制到 userData 后，用它把项目路径重定向过去。
const AGENTS_OVERRIDE = String(process.env.PI_FLOW_AGENTS_DIR || "").trim();

const posix = (p) => p.replace(/\\/g, "/");
const key = (p) => posix(resolve(p)).toLowerCase();
const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
const readJson = (file) => JSON.parse(readFileSync(file, "utf-8").replace(/^\uFEFF/, ""));
const stripPrefix = (e) => (e.startsWith("-") || e.startsWith("+") || e.startsWith("!") ? e.slice(1) : e);

function inside(parent, child) {
	const rel = relative(resolve(parent), resolve(child));
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function projectDir(manifest, name) {
	const entry = manifest.projects?.[name];
	const override = AGENTS_OVERRIDE ? resolve(AGENTS_OVERRIDE) : "";
	if (entry?.path) {
		if (override) return join(override, basename(entry.path));
		return isAbsolute(entry.path) ? resolve(entry.path) : resolve(HOME, entry.path);
	}
	if (override) return join(override, name);
	return isAbsolute(name) ? resolve(name) : resolve(manifest.projectsBase ?? HOME, name);
}

function settingsFile(dir) {
	return join(dir, ".pi", "settings.json");
}

function readSettings(dir) {
	const file = settingsFile(dir);
	if (!existsSync(file)) return { file, data: {} };
	const raw = readFileSync(file, "utf-8").replace(/^\uFEFF/, "");
	return { file, data: raw.trim() ? JSON.parse(raw) : {} };
}

function toolNames(manifest, entry) {
	let names = entry.tools ?? (entry.profile ? manifest.profiles?.[entry.profile] : []);
	if (!Array.isArray(names)) throw new Error(`profile "${entry.profile}" 不存在或不是数组`);
	const off = new Set(entry.disableTools ?? []);
	names = [...names, ...(entry.extraTools ?? [])].filter((n) => !off.has(n));
	return [...new Set(names)];
}

function wanted(manifest, entry) {
	const names = toolNames(manifest, entry);
	const extensions = names.map((n) => {
		const rel = manifest.tools?.[n];
		if (!rel) throw new Error(`tools 里没有 "${n}"`);
		return resolve(HOME, rel);
	});
	return { names, extensions };
}

/** 本目录的 extensions/，加上迁移前用过、需要一并清理的旧位置。 */
function managedRoots(manifest) {
	return [TOOLS_DIR, ...(manifest.previousHomes ?? []).map((h) => join(resolve(h), "extensions"))];
}

/** 保留项目里不属于共享目录（含历史位置）的条目，替换掉我们管理的部分。 */
function mergeEntries(current, ours, roots, baseDir) {
	const kept = (current ?? []).filter((e) => {
		const resolved = resolve(baseDir, stripPrefix(e));
		return !roots.some((root) => inside(root, resolved));
	});
	return [...kept, ...ours.map(posix)];
}

function expectedSettings(manifest, entry, data, dir) {
	const want = wanted(manifest, entry);
	const next = { ...(manifest.defaults ?? {}), ...(entry.settings ?? {}) };
	const baseDir = join(dir, ".pi");
	// 仓库内的 agent 用相对路径，整个 hub 换位置后无需重新配置。
	const inHub = inside(dirname(HOME), dir);
	const ours = want.extensions.map((ext) => (inHub ? relative(baseDir, ext) : ext));
	const ext = mergeEntries(data.extensions, ours, managedRoots(manifest), baseDir);
	if (ext.length) next.extensions = ext;
	else delete next.extensions;
	return next;
}

function expectedEnv(entry, dir) {
	if (!entry.workspace) return null;
	const file = join(dir, ".pi", "py_environment.json");
	const current = existsSync(file) ? readJson(file) : {};
	const shared = existsSync(join(HOME, "py_environment.json")) ? readJson(join(HOME, "py_environment.json")) : {};

	// 只留真正属于本项目的覆盖；与共享地址簿相同的段删除，避免地址写两份。
	const overrides = {};
	for (const [k, v] of Object.entries(current)) {
		if (k === "_comment" || k === "workspace") continue;
		if (!(k in shared) || JSON.stringify(v) !== JSON.stringify(shared[k])) overrides[k] = v;
	}
	const data = {
		_comment: `项目级覆盖。公共地址见 ${posix(join(HOME, "py_environment.json"))}`,
		...overrides,
		workspace: { root: posix(resolve(dir, entry.workspace)) },
	};
	return { file, data };
}

function expectedFlowFile(entry, dir) {
	const file = join(dir, ".pi", "pi-flow.json");
	const data = entry.isolate
		? { _comment: "由 shard/sync.mjs 生成；isolate=true 时 Pi Flow 以 --no-extensions 启动。", isolate: true }
		: null;
	return { file, data };
}

function legacyWarnings(dir) {
	const out = [];
	const extDir = join(dir, ".pi", "extensions");
	if (isDir(extDir)) {
		const ts = readdirSync(extDir).filter((f) => /\.(ts|js)$/.test(f));
		if (ts.length) out.push(`遗留 ${posix(extDir)}（${ts.join(", ")}）会被自动加载，请移走`);
	}
	return out;
}

function plan(manifest, filter) {
	const names = filter.length ? filter : Object.keys(manifest.projects ?? {});
	return names.map((name) => {
		const entry = manifest.projects?.[name];
		if (!entry) throw new Error(`agents.json 里没有项目 "${name}"`);
		if (entry.enabled === false) return null;
		const dir = projectDir(manifest, name);
		const { file, data } = readSettings(dir);
		const next = expectedSettings(manifest, entry, data, dir);
		const env = expectedEnv(entry, dir);
		const flow = expectedFlowFile(entry, dir);
		return { name, dir, settings: { file, before: data, after: next }, env, flow };
	}).filter(Boolean);
}

function same(a, b) {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function diffText(label, before, after) {
	const lines = [`  ${label}`];
	for (const k of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
		const b = before?.[k];
		const a = after?.[k];
		if (same(b, a)) continue;
		if (Array.isArray(b) || Array.isArray(a)) {
			lines.push(`    ${k}:`);
			for (const v of b ?? []) lines.push(`      - ${v}`);
			for (const v of a ?? []) lines.push(`      + ${v}`);
		} else {
			lines.push(`    ${k}: ${JSON.stringify(b ?? null)} -> ${JSON.stringify(a ?? null)}`);
		}
	}
	return lines.join("\n");
}

function printDrift(item) {
	const { file, before, after } = item.settings;
	if (!same(before, after)) console.log(diffText(posix(file), before, after));
	if (item.env) {
		const cur = existsSync(item.env.file) ? readJson(item.env.file) : {};
		if (!same(cur, item.env.data)) console.log(diffText(posix(item.env.file), cur, item.env.data));
	}
	if (item.flow) {
		const cur = existsSync(item.flow.file) ? readJson(item.flow.file) : null;
		if (item.flow.data === null) {
			if (cur !== null) console.log(`  ${posix(item.flow.file)}（将删除）`);
		} else if (!same(cur, item.flow.data)) {
			console.log(diffText(posix(item.flow.file), cur, item.flow.data));
		}
	}
	const warns = legacyWarnings(item.dir);
	for (const w of warns) console.log(`  ! ${w}`);
}

function runCheck(manifest, filter) {
	const items = plan(manifest, filter);
	let drift = 0;
	for (const item of items) {
		const { before, after } = item.settings;
		const envCur = item.env && existsSync(item.env.file) ? readJson(item.env.file) : null;
		const envSame = !item.env || same(envCur, item.env.data);
		const flowCur = item.flow && existsSync(item.flow.file) ? readJson(item.flow.file) : null;
		const flowSame =
			!item.flow || (item.flow.data === null ? flowCur === null : same(flowCur, item.flow.data));
		if (!same(before, after) || !envSame || !flowSame) {
			drift++;
			console.log(`DIFF  ${item.name}`);
			printDrift(item);
		} else {
			console.log(`OK    ${item.name}`);
		}
	}
	return drift === 0 ? 0 : 1;
}

function writeIfChanged(file, data) {
	const text = JSON.stringify(data, null, 2) + "\n";
	if (existsSync(file) && readFileSync(file, "utf-8") === text) return false;
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, text, "utf-8");
	return true;
}

function runSync(manifest, filter, dryRun) {
	const items = plan(manifest, filter);
	let changed = 0;
	for (const item of items) {
		const warns = legacyWarnings(item.dir);
		for (const w of warns) console.log(`WARN  ${item.name}: ${w}`);
		const { file, before, after } = item.settings;
		if (!same(before, after)) {
			changed++;
			if (dryRun) {
				console.log(`DRY   ${item.name}`);
				printDrift(item);
			} else {
				writeIfChanged(file, after);
				console.log(`WRITE ${item.name} -> ${posix(file)}`);
			}
		}
		if (item.env) {
			const cur = existsSync(item.env.file) ? readJson(item.env.file) : null;
			if (!same(cur, item.env.data)) {
				changed++;
				if (dryRun) console.log(`DRY   ${item.name} -> ${posix(item.env.file)}`);
				else {
					writeIfChanged(item.env.file, item.env.data);
					console.log(`WRITE ${item.name} -> ${posix(item.env.file)}`);
				}
			}
		}
		if (item.flow) {
			const cur = existsSync(item.flow.file) ? readJson(item.flow.file) : null;
			if (item.flow.data === null) {
				if (cur !== null) {
					changed++;
					if (dryRun) console.log(`DRY   ${item.name} -> 删除 ${posix(item.flow.file)}`);
					else {
						rmSync(item.flow.file, { force: true });
						console.log(`DELETE ${item.name} -> ${posix(item.flow.file)}`);
					}
				}
			} else if (!same(cur, item.flow.data)) {
				changed++;
				if (dryRun) console.log(`DRY   ${item.name} -> ${posix(item.flow.file)}`);
				else {
					writeIfChanged(item.flow.file, item.flow.data);
					console.log(`WRITE ${item.name} -> ${posix(item.flow.file)}`);
				}
			}
		}
	}
	return changed;
}

function runInit(filter, force, dryRun) {
	if (existsSync(MANIFEST) && !force) {
		console.error(`agents.json 已存在。要按现状覆盖请加 --force：${posix(MANIFEST)}`);
		return 1;
	}
	const base = process.env.PI_PROJECTS_BASE ?? "C:/Users/zjn13/Desktop/PI_work";
	const tools = {};
	const projects = {};
	for (const name of readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
		const dir = join(base, name);
		const pi = join(dir, ".pi");
		if (!isDir(pi)) continue;
		const extDir = join(pi, "extensions");
		const stems = isDir(extDir)
			? readdirSync(extDir, { withFileTypes: true })
					.filter((e) => e.isFile() && /\.(ts|js)$/.test(e.name))
					.map((e) => basename(e.name).replace(/\.(ts|js)$/, ""))
					.sort()
			: [];
		for (const s of stems) tools[s] = `extensions/${s}.ts`;
		const envFile = join(pi, "py_environment.json");
		const ws = existsSync(envFile) ? readJson(envFile).workspace?.root : undefined;
		projects[name] = { tools: stems };
		if (ws) projects[name].workspace = posix(relative(dir, ws)) || ".";
	}
	const manifest = {
		_comment: "sync.mjs 的唯一输入。tools=共享文件，profiles=工具组合，projects=各项目用哪个组合。",
		home: posix(HOME),
		projectsBase: posix(base),
		tools,
		profiles: {},
		projects,
	};
	if (dryRun) {
		console.log(JSON.stringify(manifest, null, 2));
		return 0;
	}
	writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
	console.log(`已生成 ${posix(MANIFEST)}`);
	for (const [n, p] of Object.entries(projects)) console.log(`  ${n}: ${p.tools.length ? p.tools.join(", ") : "(无工具)"}`);
	return 0;
}

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const args = argv.filter((a) => !a.startsWith("--"));
const cmd = args[0] ?? "check";
const filter = args.slice(1);
const dryRun = flags.has("--dry-run");

if (cmd === "init") {
	process.exit(runInit(filter, flags.has("--force"), dryRun));
}
if (!existsSync(MANIFEST)) {
	console.error(`缺少 ${posix(MANIFEST)}，先跑：node sync.mjs init`);
	process.exit(1);
}
const manifest = readJson(MANIFEST);
try {
	if (cmd === "sync") process.exit(runSync(manifest, filter, dryRun) >= 0 ? 0 : 1);
	if (cmd === "check") process.exit(runCheck(manifest, filter));
	console.error(`未知命令 "${cmd}"（可用：init / check / sync）`);
	process.exit(1);
} catch (e) {
	console.error(`失败: ${e instanceof Error ? e.message : String(e)}`);
	process.exit(1);
}
