import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { t } from "../../app/js/core/i18n.mjs";
import { ApiError, ROOT_DIR } from "./store.mjs";

export function singleAgentPath() {
  if (process.env.PI_FLOW_SINGLE_AGENT) return path.resolve(process.env.PI_FLOW_SINGLE_AGENT);
  const agentsRoot = String(process.env.PI_FLOW_AGENTS_ROOT || "").trim();
  const base = agentsRoot ? path.resolve(agentsRoot) : path.join(ROOT_DIR, "agents");
  return path.join(base, "GEO_Single");
}

const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;

function resolveNodeExe() {
  const candidates = [process.env.PI_NODE];
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, "node.exe"));
  }
  if (process.env.ProgramFiles) candidates.push(path.join(process.env.ProgramFiles, "nodejs", "node.exe"));
  if (process.env["ProgramFiles(x86)"]) {
    candidates.push(path.join(process.env["ProgramFiles(x86)"], "nodejs", "node.exe"));
  }
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function buildSingleCommand({ resolveExtensions } = {}) {
  if (process.platform !== "win32") throw new ApiError(400, t("单人模式目前只支持 Windows"));
  const agent = singleAgentPath();
  if (!fs.existsSync(agent)) throw new ApiError(404, t("找不到 GEO_Single：{path}", { path: agent }));

  const resources = resolveExtensions?.(agent) ?? { noExtensions: false, extensions: [] };
  const piArgs = ["--approve"];
  if (resources.noExtensions) {
    piArgs.push("--no-extensions");
    for (const extension of resources.extensions) piArgs.push("--extension", quote(extension));
  }

  const lines = ["@echo off", "chcp 65001 >nul", "title Pi Flow 单人模式"];

  const piBin = String(process.env.PI_BIN || "").trim();
  const nodeExe = resolveNodeExe();
  let command;
  if (piBin && piBin.toLowerCase().endsWith(".js") && fs.existsSync(piBin) && nodeExe) {
    // 必须用真正的 node.exe 启动：Electron 是 GUI 子系统程序，在 cmd 窗口里拿不到正常的控制台，
    // cmd 也不会等它，pi 的 TUI 起不来，表现为窗口空白、命令像没执行。
    command = [quote(nodeExe), quote(piBin), ...piArgs].join(" ");
  }
  else if (piBin && piBin.toLowerCase().endsWith(".js") && fs.existsSync(piBin)) {
    throw new ApiError(
      500,
      t("找不到 node.exe，无法在外部终端启动单人模式。请重新运行安装程序修复运行环境。"),
    );
  }
  else if (piBin && fs.existsSync(piBin) && !/\.(cmd|ps1|bat)$/i.test(piBin)) {
    command = [quote(piBin), ...piArgs].join(" ");
  }
  else {
    command = ["pi", ...piArgs].join(" ");
  }

  const configPath = String(process.env.PI_ENV_JSON || "").trim();
  const home = String(process.env.PI_FLOW_HOME || "").trim();
  if (configPath && fs.existsSync(configPath)) {
    lines.push(`set "PI_ENV_JSON=${configPath}"`);
  }
  if (home) {
    lines.push(`set "PI_FLOW_HOME=${home}"`);
  }
  lines.push(`cd /d ${quote(agent)}`);
  lines.push(command, "");

  return { agent, script: lines.join("\r\n") };
}

export function launchSingle({ resolveExtensions } = {}) {
  const { agent, script } = buildSingleCommand({ resolveExtensions });
  const file = path.join(os.tmpdir(), "pi-flow-single.cmd");
  fs.writeFileSync(file, script, "utf8");

  const child = spawn("cmd.exe", ["/c", "start", "", "cmd.exe", "/k", file], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();

  return { agent, command: file };
}
