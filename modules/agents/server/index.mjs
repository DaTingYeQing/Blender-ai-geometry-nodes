import fsp from "node:fs/promises";
import path from "node:path";
import { t } from "../../../app/js/core/i18n.mjs";

export function createAgentsServer({ store }) {
  const { ApiError, db, now, rid, saveState } = store;

  function list() {
    return db.state.agents;
  }

  function get(id) {
    return db.state.agents.find((agent) => agent.id === id) || null;
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
      reused,
    };
  }

  function bindSession(agentId, internalId, piSessionId) {
    const session = get(agentId)?.sessions?.find((item) => item.id === internalId);
    if (session) session.piSessionId = piSessionId;
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

  const api = { list, get, create, remove, beginSession, bindSession, finishSession };

  return {
    api,
    routes: [
      {
        method: "GET",
        path: "/api/agents",
        handler: () => ({ agents: list() }),
      },
      {
        method: "POST",
        path: "/api/agents",
        handler: async ({ body }) => {
          const agent = await create(body);
          await saveState();
          return { agent };
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
