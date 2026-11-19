/**
 * 读取 Pi 自己落盘的会话记录（JSONL），转成纸扇能直接浏览的条目。
 *
 * 文件位置由 pi 决定：<session root>/--<cwd 转义>--/<时间戳>_<session-id>.jsonl
 * 这里只做三件事：找到文件、还原当前分支、把消息块转成可读条目。
 * 文本类的正文用 shared/markdown.mjs 渲染成 HTML（渲染前整体转义）；
 * 工具调用的参数和输出保持纯文本，前端用 textContent 写，避免注入。
 */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderMarkdown } from "../../../shared/markdown.mjs";

const MAX_ENTRIES = 200;
const MAX_TEXT = 6000;
const MAX_TOOL_ARGS = 600;
const MAX_TOOL_OUTPUT = 2000;

function clip(text, limit) {
  const value = String(text ?? "");
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

/** pi 的目录规则：去掉开头的分隔符，再把 / \ : 全换成 -，两头包 --。 */
export function sessionDirName(cwd) {
  const escaped = String(cwd || "")
    .replace(/^[\\/]+/, "")
    .replace(/[\\/:]/g, "-");
  return `--${escaped}--`;
}

export function sessionRoots() {
  const root = process.env.PI_CODING_AGENT_SESSION_DIR || path.join(os.homedir(), ".pi", "agent", "sessions");
  return [root];
}

export async function findSessionFile(cwd, sessionId) {
  const id = String(sessionId || "");
  if (!id) return null;
  const suffix = `_${id}.jsonl`;

  const dirs = [];
  for (const root of sessionRoots()) {
    dirs.push(path.join(root, sessionDirName(cwd)), root);
  }

  for (const dir of dirs) {
    let names;
    try {
      names = await fsp.readdir(dir);
    } catch {
      continue;
    }
    const hit = names.find((name) => name.endsWith(suffix));
    if (hit) return path.join(dir, hit);
  }
  return null;
}

function blocksOf(content) {
  if (Array.isArray(content)) return content.filter(Boolean);
  if (typeof content === "string" && content) return [{ type: "text", text: content }];
  return [];
}

function textOf(content) {
  return blocksOf(content)
    .filter((block) => block.type === "text" && block.text)
    .map((block) => String(block.text))
    .join("\n")
    .trim();
}

function summarizeArgs(args) {
  if (!args || typeof args !== "object") return "";
  let text;
  if (args.command) text = String(args.command);
  else if (args.path) text = String(args.path);
  else if (args.file_path) text = String(args.file_path);
  else text = JSON.stringify(args);
  return clip(text.replace(/\s+/g, " ").trim(), MAX_TOOL_ARGS);
}

/** 会话是树：从最后一条沿着 parentId 走到根，才是当前分支。 */
function activeBranch(records) {
  const withIds = records.filter((record) => record && typeof record.id === "string" && "parentId" in record);
  if (!withIds.length) return records;

  const byId = new Map(withIds.map((record) => [record.id, record]));
  const chain = [];
  const seen = new Set();
  let cursor = withIds[withIds.length - 1];

  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.push(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
  }
  return chain.reverse();
}

function titleFromEntries(entries) {
  const first = entries.find((entry) => entry.kind === "user");
  if (!first) return "";
  const plain = String(first.text || "")
    .replace(/[#>*`_~[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clip(plain, 40);
}

/**
 * 纯函数：JSONL 文本 -> { session, entries, truncated }。
 * 导出给测试用，不碰文件系统。
 */
export function parseSessionText(text, options = {}) {
  const id = String(options.id || "");
  const records = String(text || "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const header = records.find((record) => record.type === "session") || null;
  const branch = activeBranch(records.filter((record) => record.type !== "session"));

  const entries = [];
  const tools = new Map();
  let messages = 0;

  branch.forEach((record) => {
    if (record.type !== "message" || !record.message) return;
    const message = record.message;
    if (message.role === "system") return;

    if (message.role === "user") {
      const text = textOf(message.content);
      if (!text) return;
      messages += 1;
      entries.push({ kind: "user", text, html: renderMarkdown(clip(text, MAX_TEXT)) });
      return;
    }

    if (message.role === "assistant") {
      messages += 1;
      blocksOf(message.content).forEach((block) => {
        if (block.type === "thinking" && block.thinking && !block.redacted) {
          entries.push({
            kind: "thinking",
            text: String(block.thinking),
            html: renderMarkdown(clip(block.thinking, MAX_TEXT)),
          });
        } else if (block.type === "text" && block.text) {
          entries.push({
            kind: "assistant",
            text: String(block.text),
            html: renderMarkdown(clip(block.text, MAX_TEXT)),
          });
        } else if (block.type === "toolCall") {
          const entry = {
            kind: "tool",
            name: block.name || "tool",
            args: summarizeArgs(block.arguments),
            state: "running",
            output: "",
          };
          tools.set(block.id, entry);
          entries.push(entry);
        }
      });
      return;
    }

    if (message.role === "toolResult") {
      const output = clip(textOf(message.content), MAX_TOOL_OUTPUT);
      const entry = tools.get(message.toolCallId);
      if (entry) {
        entry.state = message.isError ? "error" : "done";
        entry.output = output;
      } else {
        entries.push({
          kind: "tool",
          name: message.toolName || "tool",
          args: "",
          state: message.isError ? "error" : "done",
          output,
        });
      }
    }
  });

  let truncated = false;
  let visible = entries;
  if (visible.length > MAX_ENTRIES) {
    visible = visible.slice(-MAX_ENTRIES);
    truncated = true;
  }

  return {
    session: {
      id: id || header?.id || "",
      title: titleFromEntries(visible) || `会话 ${String(id || header?.id || "").slice(0, 8)}`.trim(),
      cwd: header?.cwd || options.cwd || "",
      createdAt: header?.timestamp || null,
      updatedAt: options.updatedAt || null,
      messageCount: messages,
    },
    entries: visible,
    truncated,
  };
}

export async function readSessionTranscript(cwd, sessionId, sessionFile) {
  let file = null;
  if (sessionFile) {
    try {
      const stat = await fsp.stat(sessionFile);
      if (stat.isFile()) file = sessionFile;
    } catch {
      // 会话文件被删了就退回按 cwd + id 查找
    }
  }
  if (!file) file = await findSessionFile(cwd, sessionId);
  if (!file) {
    return {
      session: {
        id: String(sessionId || ""),
        title: `会话 ${String(sessionId || "").slice(0, 8)}`.trim(),
        cwd: String(cwd || ""),
        createdAt: null,
        updatedAt: null,
        messageCount: 0,
      },
      entries: [],
      truncated: false,
      missing: true,
    };
  }

  const [text, stat] = await Promise.all([fsp.readFile(file, "utf8"), fsp.stat(file)]);
  const parsed = parseSessionText(text, {
    id: sessionId,
    cwd,
    updatedAt: stat.mtime?.toISOString?.() || null,
  });
  return { ...parsed, missing: false };
}
