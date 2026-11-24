import fsp from "node:fs/promises";
import path from "node:path";
import { t } from "../../../shared/messages.mjs";
import { readSessionTranscript } from "./session.mjs";

export function createAgentsServer({ store }) {
  const { ApiError, db, now, rid, saveState } = store;

  function list() {
    return db.state.agents;
  }

  function get(id) {
    return db.state.agents.find((agent) => agent.id === id) || null;
  }

  function rename(id, name) {
    const agent = get(id);
    if (!agent) throw new ApiError(404, t("Agent 不存在"));
    const next = String(name ?? "").trim();
    if (!next) throw new ApiError(400, t("Agent 名称不能为空"));
    agent.name = next;
    return agent;
  }

  function normalizePath(input) {
    const raw = String(input || "").trim();
    if (!raw) throw new ApiError(400, t("项目路径不能为空"));
    if (!path.isAbsolute(raw)) {
      throw new ApiError(400, t("项目路径必须是绝对路径，例如 C:\\Users\\你\\Desktop\\项目"));
    }
    return path.resolve(raw);
  }

  async function assertDirectory(target) {
    let stat;
    try {
      stat = await fsp.stat(target);
    } catch {
      throw new ApiError(400, t("项目路径不存在：{path}", { path: target }));
    }
    if (!stat.isDirectory()) throw new ApiError(400, t("项目路径不是目录：{path}", { path: target }));
  }

  async function create(body) {
    const name = String(body.name || "").trim();
    if (!name) throw new ApiError(400, t("Agent 名称不能为空"));

    const projectPath = normalizePath(body.projectPath);
    await assertDirectory(projectPath);

    const agent = {
      id: rid("agent"),
      name,
      projectPath,
      createdAt: now(),
      sessions: [],
    };
    db.state.agents.push(agent);
    return agent;
  }

  function beginSession(agentId, node) {
    const agent = get(agentId);
    if (!agent) throw new ApiError(404, t("Agent 不存在"));

    let session = null;
    if (node.sessionMode === "reuse" && node.sessionId) {
      session = agent.sessions?.find((item) => item.id === node.sessionId) || null;
    }

    let reused = false;
    if (session) {
      session.lastUsedAt = now();
      reused = Boolean(session.piSessionId);
    } else {
      session = {
        id: rid("sess"),
        piSessionId: null,
        piSessionFile: null,
        title: `${node.title || agent.name} · ${new Date().toLocaleString("zh-CN")}`,
        messageCount: 0,
        artifactCount: 0,
        createdAt: now(),
        lastUsedAt: now(),
      };
      agent.sessions ||= [];
      agent.sessions.unshift(session);
    }

    return {
      agent: { id: agent.id, name: agent.name, projectPath: agent.projectPath },
      internalId: session.id,
      piSessionId: session.piSessionId,
      piSessionFile: session.piSessionFile || null,
      reused,
    };
  }

  function bindSession(agentId, internalId, piSessionId, piSessionFile) {
    const session = get(agentId)?.sessions?.find((item) => item.id === internalId);
    if (!session) return;
    if (piSessionId) session.piSessionId = piSessionId;
    if (piSessionFile) session.piSessionFile = piSessionFile;
  }

  function finishSession(agentId, internalId, artifactCount) {
    const session = get(agentId)?.sessions?.find((item) => item.id === internalId);
    if (!session) return;
    session.messageCount += 1;
    session.artifactCount += artifactCount;
    session.lastUsedAt = now();
  }

  async function remove(id) {
    const index = db.state.agents.findIndex((agent) => agent.id === id);
    if (index === -1) throw new ApiError(404, t("Agent 不存在"));
    const [agent] = db.state.agents.splice(index, 1);
    return agent;
  }

  /* 会话只是 Agent 名下的一条记录，改名 / 删除都只动这条记录，
   * 不碰 pi 自己写的会话文件。
   * 路径里的会话 id 同时认内部 id 和 pi 的会话 id，三个入口共用这套解析。 */
  function matchSession(item, sessionId) {
    return item.id === sessionId || (item.piSessionId && item.piSessionId === sessionId);
  }

  function findSession(agentId, sessionId) {
    const agent = get(agentId);
    if (!agent) throw new ApiError(404, t("Agent 不存在"));
    const session = (agent.sessions || []).find((item) => matchSession(item, sessionId));
    if (!session) throw new ApiError(404, t("会话不存在"));
    return session;
  }

  function renameSession(agentId, sessionId, title) {
    const session = findSession(agentId, sessionId);
    const next = String(title ?? "").trim();
    if (!next) throw new ApiError(400, t("会话名称不能为空"));
    session.title = next;
    return session;
  }

  function removeSession(agentId, sessionId) {
    const agent = get(agentId);
    if (!agent) throw new ApiError(404, t("Agent 不存在"));
    const before = (agent.sessions || []).length;
    agent.sessions = (agent.sessions || []).filter((item) => !matchSession(item, sessionId));
    if (agent.sessions.length === before) throw new ApiError(404, t("会话不存在"));
    return { ok: true };
  }

  const api = {
    list,
    get,
    rename,
    create,
    remove,
    beginSession,
    bindSession,
    finishSession,
    renameSession,
    removeSession,
  };

  return {
    api,
    routes: [
      {
        method: "GET",
        path: "/api/agents",
        handler: () => ({ agents: list() }),
      },
      {
        method: "GET",
        pattern: /^\/api\/agents\/([^/]+)\/sessions\/([^/]+)$/,
        handler: async ({ params }) => {
          const agent = get(decodeURIComponent(params[1]));
          if (!agent) throw new ApiError(404, t("Agent 不存在"));
          const id = decodeURIComponent(params[2]);
          const session = (agent.sessions || []).find((item) => matchSession(item, id));
          // 没有登记记录时仍按传入的 id 尝试读盘（pi 的会话文件可能还在）。
          const piSessionId = session?.piSessionId || id;
          return readSessionTranscript(agent.projectPath, piSessionId, session?.piSessionFile);
        },
      },
      {
        method: "PATCH",
        pattern: /^\/api\/agents\/([^/]+)\/sessions\/([^/]+)$/,
        handler: async ({ params, body }) => {
          const session = renameSession(
            decodeURIComponent(params[1]),
            decodeURIComponent(params[2]),
            body?.title,
          );
          await saveState();
          return { session };
        },
      },
      {
        method: "DELETE",
        pattern: /^\/api\/agents\/([^/]+)\/sessions\/([^/]+)$/,
        handler: async ({ params }) => {
          const result = removeSession(
            decodeURIComponent(params[1]),
            decodeURIComponent(params[2]),
          );
          await saveState();
          return result;
        },
      },
      {
        method: "DELETE",
        pattern: /^\/api\/agents\/([^/]+)$/,
        handler: async ({ params }) => {
          await remove(params[1]);
          await saveState();
          return { ok: true };
        },
      },
    ],
  };
}
