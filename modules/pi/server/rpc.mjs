import fs from "node:fs";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
import { t } from "../../../app/js/core/i18n.mjs";

/** 优先环境变量，其次全局 npm root，最后兜底 APPDATA 下的常规安装路径。 */
export function resolvePiBin() {
  if (process.env.PI_BIN) return process.env.PI_BIN;

  const candidates = [];
  try {
    const root = execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    candidates.push(path.join(root, "@earendil-works/pi-coding-agent/dist/bundle/cli.js"));
    candidates.push(path.join(root, "@earendil-works/pi-coding-agent/dist/cli.js"));
  } catch {
    // npm 不可用时继续走兜底
  }
  candidates.push(
    path.join(process.env.APPDATA || "", "npm/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"),
    path.join(process.env.APPDATA || "", "npm/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
  );

  return candidates.find((file) => fs.existsSync(file)) || "pi";
}

export const PI_BIN = resolvePiBin();

export function buildPiArgs({ sessionId, noExtensions, extensions } = {}) {
  const args = [PI_BIN, "--mode", "rpc", "--approve"];
  if (noExtensions) args.push("--no-extensions");
  for (const extension of extensions ?? []) args.push("--extension", String(extension));
  if (sessionId) args.push("--session-id", String(sessionId));
  return args;
}

const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);

function summarizeArgs(toolName, args) {
  if (!args || typeof args !== "object") return "";
  let text = "";
  if (toolName === "bash" || toolName === "powershell") text = String(args.command || "");
  else if (args.path) text = String(args.path);
  else if (args.file_path) text = String(args.file_path);
  else text = JSON.stringify(args);
  text = text.replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function killTree(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    try {
      child.kill();
    } catch {
      // 进程可能已退出
    }
  }
}

/**
 * 启动一次 pi RPC 会话，逐条解析 stdout 的 JSONL 记录。
 * 返回 { promise, abort }；promise 在 agent_settled（或提前退出）后落地。
 *
 * @param {object} options
 * @param {string} options.cwd        pi 的工作目录（项目根）
 * @param {string} options.prompt     发给 agent 的任务文本
 * @param {string} options.sessionId  pi 会话 id（--session-id，存在则复用）
 * @param {Record<string, string>} [options.env]  额外注入给 pi 子进程的环境变量
 * @param {boolean} [options.noExtensions]  禁用扩展发现，只加载显式传入的扩展
 * @param {string[]} [options.extensions]  显式加载的扩展路径（配合 noExtensions）
 * @param {number} [options.timeoutMs]
 * @param {(line: string) => void} [options.onLog]
 * @param {(text: string) => void} [options.onText]
 * @param {(activity: object) => void} [options.onActivity]  思考、输出和工具调用事件
 * @param {(sessionId: string) => void} [options.onSessionId]
 */
export function startPi({
  cwd,
  prompt,
  sessionId,
  env: extraEnv,
  noExtensions,
  extensions,
  timeoutMs = 15 * 60_000,
  onLog,
  onText,
  onActivity,
  onSessionId,
}) {
  const args = buildPiArgs({ sessionId, noExtensions, extensions });

  const env = { ...process.env, ...extraEnv };
  // Electron 主进程里 process.execPath 是 electron.exe，这个变量让它按 Node 运行。
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";

  const child = spawn(process.execPath, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const log = (line) => onLog?.(line);

  let settledResolve;
  let settledReject;
  let finished = false;
  let stdoutBuffer = "";
  let replyText = "";
  let settled = false;
  const startedAt = Date.now();

  const promise = new Promise((resolve, reject) => {
    settledResolve = resolve;
    settledReject = reject;
  });

  const finish = (error, payload) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (error) settledReject(error instanceof Error ? error : new Error(String(error)));
    else settledResolve(payload);
  };

  const timer = setTimeout(() => {
    const seconds = Math.round(timeoutMs / 1000);
    log(t("超时（{s}s），已终止", { s: seconds }));
    killTree(child);
    finish(new Error(t("运行超时（{s} 秒）", { s: seconds })));
  }, timeoutMs);

  const send = (record) => {
    if (child.stdin.destroyed) return;
    try {
      child.stdin.write(`${JSON.stringify(record)}\n`);
    } catch {
      // 进程已退出
    }
  };

  const handleRecord = (record) => {
    switch (record.type) {
      case "response": {
        if (record.command === "prompt") {
          if (!record.success) {
            finish(new Error(record.error || t("prompt 被拒绝")));
            return;
          }
          const disposition = record.data?.disposition;
          if (disposition && disposition !== "started") {
            finish(null, { text: replyText, disposition, durationMs: Date.now() - startedAt });
            return;
          }
          // 新会话由 pi 自己生成 id，拿 state 回填给上层记录。
          send({ id: "state-1", type: "get_state" });
        }
        if (record.command === "get_state" && record.success) {
          const actual = record.data?.sessionId;
          if (actual) onSessionId?.(actual);
        }
        return;
      }

      case "tool_execution_start": {
        log(`→ ${record.toolName} ${summarizeArgs(record.toolName, record.args)}`.trim());
        onActivity?.({
          kind: "tool_start",
          toolCallId: record.toolCallId,
          toolName: record.toolName,
          args: record.args,
        });
        return;
      }

      case "tool_execution_end": {
        const mark = record.isError ? "✗" : "✓";
        const duration = Number.isFinite(record.durationMs) ? ` ${record.durationMs}ms` : "";
        log(`${mark} ${record.toolName}${duration}`);
        onActivity?.({
          kind: "tool_end",
          toolCallId: record.toolCallId,
          toolName: record.toolName,
          isError: Boolean(record.isError),
          durationMs: record.durationMs,
        });
        return;
      }

      case "message_update": {
        const event = record.assistantMessageEvent;
        if (event?.type === "text_delta" && event.delta) {
          if (replyText.length < 20_000) replyText += event.delta;
          onText?.(replyText);
          onActivity?.({ kind: "text", delta: event.delta });
        } else if (event?.type === "thinking_delta" && event.delta) {
          onActivity?.({ kind: "thinking", delta: event.delta });
        }
        return;
      }

      case "agent_settled": {
        settled = true;
        finish(null, {
          text: replyText,
          aborted: Boolean(record.aborted),
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      case "extension_ui_request": {
        if (DIALOG_METHODS.has(record.method)) {
          log(t("扩展请求 {method}（原型中自动取消）", { method: record.method }));
          send({ type: "extension_ui_response", id: record.id, cancelled: true });
        } else {
          log(t("扩展请求 {method}（原型中自动忽略）", { method: record.method }));
        }
        return;
      }

      default:
        return;
    }
  };

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() || "";
    for (let line of lines) {
      line = line.replace(/\r$/, "");
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        log(t("非 JSON 输出：{text}", { text: line.slice(0, 120) }));
        continue;
      }
      handleRecord(record);
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8").trim();
    if (text) log(`stderr: ${text.slice(0, 300)}`);
  });

  child.on("error", (error) => {
    finish(new Error(t("无法启动 pi：{message}（{bin}）", { message: error.message, bin: PI_BIN })));
  });

  child.on("exit", (code, signal) => {
    if (finished) return;
    if (settled) {
      finish(null, { text: replyText, aborted: false, durationMs: Date.now() - startedAt });
      return;
    }
    const reason = signal ? t("信号 {signal}", { signal }) : t("退出码 {code}", { code });
    finish(new Error(t("pi 提前退出（{reason}）", { reason })));
  });

  // agent_settled 之后关闭 stdin，让 pi 走有序退出。then/catch 两个分支都要清理。
  const cleanup = () => {
    try {
      child.stdin.end();
    } catch {
      // 已关闭
    }
    setTimeout(() => killTree(child), 3000).unref?.();
  };
  promise.then(cleanup, cleanup);

  send({ id: "prompt-1", type: "prompt", message: prompt });

  return {
    promise,
    abort: () => {
      log(t("收到中止请求"));
      killTree(child);
      finish(new Error(t("运行已中止")));
    },
  };
}
