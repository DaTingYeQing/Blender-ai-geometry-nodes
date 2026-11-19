import { execSync, spawn } from "node:child_process";
import { t } from "../../../shared/messages.mjs";
import { PI_BIN, buildPiArgs } from "./args.mjs";
import { DIALOG_METHODS, assistantText, summarizeToolArgs } from "./events.mjs";

export { PI_BIN, buildPiArgs, resolvePiBin } from "./args.mjs";

const MAX_STDOUT_RECORD = 8 * 1024 * 1024;
const MAX_REPLY_CHARS = 20_000;
const STATE_TIMEOUT_MS = 5_000;
const ABORT_GRACE_MS = 5_000;

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
 *
 * 生命周期：
 *   1. 先 get_state，拿 sessionId + sessionFile，再发 prompt；
 *   2. prompt 被接受后等 agent_settled，中途用 message_end 校准最终文本；
 *   3. abort 先发 RPC abort，超时才杀进程。
 *
 * 返回 { promise, abort, sessionInfo }。
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
  onSessionInfo,
}) {
  const args = buildPiArgs({ sessionId, noExtensions, extensions });

  const env = { ...process.env, ...extraEnv };
  // Electron 主进程里 process.execPath 是 electron.exe，这个变量让它按 Node 运行。
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";

  const child = spawn(process.execPath, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const log = (line) => onLog?.(line);
  const startedAt = Date.now();

  let finished = false;
  let settled = false;
  let abortRequested = false;
  let promptSent = false;
  let replyText = "";
  let stdoutBuffer = "";
  let timeoutTimer = null;
  let stateTimer = null;
  let abortTimer = null;

  const sessionInfo = { sessionId: null, sessionFile: null };

  let settledResolve;
  let settledReject;
  const promise = new Promise((resolve, reject) => {
    settledResolve = resolve;
    settledReject = reject;
  });

  const finish = (error, payload) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeoutTimer);
    clearTimeout(stateTimer);
    clearTimeout(abortTimer);
    if (error) settledReject(error instanceof Error ? error : new Error(String(error)));
    else settledResolve(payload);
  };

  function send(record) {
    if (child.stdin.destroyed) return;
    try {
      child.stdin.write(`${JSON.stringify(record)}\n`);
    } catch {
      // 进程已退出
    }
  }

  function sendPrompt() {
    if (promptSent || finished) return;
    promptSent = true;
    clearTimeout(stateTimer);
    stateTimer = null;
    send({ id: "prompt-1", type: "prompt", message: prompt });
  }

  function resultPayload(disposition) {
    return {
      text: replyText,
      aborted: false,
      disposition,
      durationMs: Date.now() - startedAt,
      sessionId: sessionInfo.sessionId,
      sessionFile: sessionInfo.sessionFile,
    };
  }

  function rememberSession(data) {
    if (!data) return;
    if (data.sessionId) sessionInfo.sessionId = String(data.sessionId);
    if (data.sessionFile) sessionInfo.sessionFile = String(data.sessionFile);
    if (sessionInfo.sessionId || sessionInfo.sessionFile) {
      onSessionInfo?.({ ...sessionInfo });
      if (sessionInfo.sessionId) onSessionId?.(sessionInfo.sessionId);
    }
  }

  timeoutTimer = setTimeout(() => {
    const seconds = Math.round(timeoutMs / 1000);
    log(t("超时（{s}s），已终止", { s: seconds }));
    send({ type: "abort", id: "abort-timeout" });
    setTimeout(() => killTree(child), 2000).unref?.();
    finish(new Error(t("运行超时（{s} 秒）", { s: seconds })));
  }, timeoutMs);

  stateTimer = setTimeout(() => {
    stateTimer = null;
    log(t("获取会话状态超时，直接发送任务"));
    sendPrompt();
  }, STATE_TIMEOUT_MS);

  const handleRecord = (record) => {
    switch (record.type) {
      case "response": {
        if (record.command === "get_state") {
          if (record.success) rememberSession(record.data);
          else log(t("获取会话状态失败：{message}", { message: record.error || "" }));
          sendPrompt();
          return;
        }

        if (record.command === "abort") {
          if (!record.success) log(t("中止失败：{message}", { message: record.error || "" }));
          finish(new Error(t("运行已中止")));
          return;
        }

        if (record.command === "prompt") {
          if (!record.success) {
            finish(new Error(record.error || t("prompt 被拒绝")));
            return;
          }
          const disposition = record.data?.disposition || "started";
          if (disposition === "handled") {
            finish(null, resultPayload(disposition));
            return;
          }
          if (disposition === "queued") log(t("任务已排队，等待 agent_settled"));
          else if (disposition !== "started") {
            log(t("未知 disposition：{value}，继续等待 agent_settled", { value: disposition }));
          }
          // 先前的 get_state 没回来时，趁运行中再补一次，保证会话能绑定。
          if (!sessionInfo.sessionId && !sessionInfo.sessionFile) {
            send({ id: "state-2", type: "get_state" });
          }
        }
        return;
      }

      case "tool_execution_start": {
        log(`→ ${record.toolName} ${summarizeToolArgs(record.toolName, record.args)}`.trim());
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
          if (replyText.length < MAX_REPLY_CHARS) replyText += event.delta;
          onText?.(replyText);
          onActivity?.({ kind: "text", delta: event.delta });
        } else if (event?.type === "thinking_delta" && event.delta) {
          onActivity?.({ kind: "thinking", delta: event.delta });
        }
        return;
      }

      case "message_end": {
        const text = assistantText(record.message);
        if (text) {
          replyText = text;
          onText?.(replyText);
        }
        return;
      }

      case "agent_end": {
        if (record.willRetry) log(t("本轮结束，pi 将自动重试"));
        return;
      }

      case "agent_settled": {
        settled = true;
        if (record.aborted || abortRequested) {
          finish(new Error(t("运行已中止")));
          return;
        }
        finish(null, resultPayload("settled"));
        return;
      }

      case "compaction_start": {
        log(t("压缩上下文（{reason}）", { reason: record.reason || "auto" }));
        return;
      }

      case "compaction_end": {
        if (record.errorMessage) log(t("压缩失败：{message}", { message: record.errorMessage }));
        else log(t("压缩完成"));
        return;
      }

      case "auto_retry_start": {
        log(
          t("自动重试 {attempt}/{max}（{delay}ms）", {
            attempt: record.attempt,
            max: record.maxAttempts,
            delay: record.delayMs,
          }),
        );
        return;
      }

      case "auto_retry_end": {
        if (record.success === false) {
          log(t("自动重试失败：{message}", { message: record.finalError || "" }));
        }
        return;
      }

      case "extension_ui_request": {
        if (DIALOG_METHODS.has(record.method)) {
          log(t("扩展请求 {method}（原型中自动取消）", { method: record.method }));
          send({ type: "extension_ui_response", id: record.id, cancelled: true });
        } else if (record.method === "notify") {
          log(t("扩展通知：{message}", { message: record.message || "" }));
        } else if (record.method === "setStatus" && record.statusText) {
          log(`[${record.statusKey || "pi"}] ${record.statusText}`);
        }
        return;
      }

      default:
        return;
    }
  };

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    if (stdoutBuffer.length > MAX_STDOUT_RECORD) {
      finish(new Error(t("pi 输出记录过大")));
      killTree(child);
      return;
    }

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
    if (abortRequested) {
      finish(new Error(t("运行已中止")));
      return;
    }
    if (settled) {
      finish(null, resultPayload("settled"));
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

  // 先取会话状态：sessionFile 比按 cwd 猜路径可靠。
  send({ id: "state-1", type: "get_state" });

  return {
    promise,
    abort: () => {
      if (finished || abortRequested) return;
      abortRequested = true;
      log(t("收到中止请求"));
      send({ type: "abort", id: "abort-1" });
      abortTimer = setTimeout(() => {
        abortTimer = null;
        log(t("中止超时，强制终止"));
        killTree(child);
        finish(new Error(t("运行已中止")));
      }, ABORT_GRACE_MS);
    },
    get sessionInfo() {
      return { ...sessionInfo };
    },
  };
}
