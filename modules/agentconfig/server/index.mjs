import fsp from "node:fs/promises";
import path from "node:path";
import { t } from "../../../shared/messages.mjs";

function publicAgent(agent) {
  return { id: agent.id, name: agent.name, projectPath: agent.projectPath };
}

/** 名字要能当 Windows 目录名用；非法字符换成短横线。 */
function folderName(name) {
  const base = String(name || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "");
  const fallback = base || "agent";
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(fallback) ? `agent-${fallback}` : fallback;
}

export function createAgentConfigServer({ store, tools, agents }) {
  const { ApiError, dataDir, ensureDir, saveState } = store;

  function agentsRoot() {
    const override = String(process.env.PI_FLOW_AGENTS_ROOT || "").trim();
    return override ? path.resolve(override) : path.join(dataDir(), "agents");
  }

  /** 新建目录并返回路径；重名时自动加 -2、-3。 */
  async function createUniqueDir(root, name) {
    await ensureDir(root);
    const base = folderName(name);
    for (let i = 0; i < 100; i += 1) {
      const dir = path.join(root, i === 0 ? base : `${base}-${i + 1}`);
      try {
        await fsp.mkdir(dir);
        return dir;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
    throw new ApiError(400, t("无法为 Agent 分配目录：{path}", { path: root }));
  }

  function readToolsList(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new ApiError(400, t("工具列表必须是数组"));
    return value;
  }

  function catalog() {
    const data = tools.catalog();
    return { tools: Object.keys(data.tools || {}), profiles: data.profiles || {} };
  }

  function get(id) {
    const agent = agents.get(id);
    if (!agent) throw new ApiError(404, t("Agent 不存在"));
    try {
      const result = tools.readAgentConfig(agent.projectPath);
      return {
        agent: publicAgent(agent),
        config: { ...result.config, tools: result.selection.names },
        derived: result.derived,
      };
    } catch (error) {
      throw new ApiError(400, String(error?.message || error));
    }
  }

  async function save(id, body = {}) {
    const agent = agents.get(id);
    if (!agent) throw new ApiError(404, t("Agent 不存在"));

    const name = String(body.name || "").trim();
    if (!name) throw new ApiError(400, t("Agent 名称不能为空"));
    const toolsList = readToolsList(body.tools);

    let result;
    try {
      result = await tools.writeAgentConfig(agent.projectPath, { tools: toolsList });
    } catch (error) {
      throw new ApiError(400, String(error?.message || error));
    }

    agents.rename(id, name);
    await saveState();
    return {
      agent: publicAgent(agent),
      config: { ...result.config, tools: result.selection.names },
    };
  }

  async function create(body = {}) {
    const name = String(body.name || "").trim();
    if (!name) throw new ApiError(400, t("Agent 名称不能为空"));
    const toolsList = readToolsList(body.tools);

    const projectPath = await createUniqueDir(agentsRoot(), name);
    try {
      const result = await tools.writeAgentConfig(projectPath, { tools: toolsList });
      const agent = await agents.create({ name, projectPath });
      await saveState();
      return {
        agent: publicAgent(agent),
        config: { ...result.config, tools: result.selection.names },
      };
    } catch (error) {
      await fsp.rm(projectPath, { recursive: true, force: true }).catch(() => {});
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, String(error?.message || error));
    }
  }

  return {
    api: { catalog, get, save, create },
    routes: [
      {
        method: "GET",
        path: "/api/tools",
        handler: () => catalog(),
      },
      {
        method: "POST",
        path: "/api/agents/create",
        handler: async ({ body }) => create(body),
      },
      {
        method: "GET",
        pattern: /^\/api\/agents\/([^/]+)\/config$/,
        handler: ({ params }) => get(decodeURIComponent(params[1])),
      },
      {
        method: "PUT",
        pattern: /^\/api\/agents\/([^/]+)\/config$/,
        handler: async ({ params, body }) => save(decodeURIComponent(params[1]), body),
      },
    ],
  };
}
