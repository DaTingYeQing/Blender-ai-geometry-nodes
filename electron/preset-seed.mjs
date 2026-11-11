import path from "node:path";

/**
 * 首次安装时写入默认预设流程。
 * 节点只记录项目 key，播种时再解析成实际的 agentId，避免安装时生成的随机 id 对不上。
 * meta.seededPresets 记录已经播种过的预设，用户删掉后不会重新加回来。
 */
export function seedPresetFlow(state, preset, templates, { rid, now }) {
  state.flows ||= [];
  state.meta ||= {};
  state.meta.seededPresets ||= [];

  const key = preset?.id || preset?.name;
  if (!key || !preset?.name || !Array.isArray(preset.nodes) || !preset.nodes.length) return false;
  if (state.meta.seededPresets.includes(key)) return false;

  const pathByProject = new Map(
    (templates || []).filter((item) => item?.project && item?.projectPath).map((item) => [
      item.project,
      path.resolve(item.projectPath),
    ]),
  );
  const agentByPath = new Map(state.agents.map((agent) => [path.resolve(agent.projectPath || ""), agent]));

  const nodes = [];
  const byKey = new Map();
  const usedAgentIds = new Set();
  for (const item of preset.nodes) {
    if (!item?.key || usedAgentIds.has(item.agent)) continue;
    const projectPath = pathByProject.get(item.agent);
    const agent = projectPath ? agentByPath.get(projectPath) : null;
    if (!agent) continue;
    const node = {
      id: rid("node"),
      agentId: agent.id,
      title: item.title || agent.name,
      x: Number(item.x) || 0,
      y: Number(item.y) || 0,
      task: String(item.task || ""),
      color: Math.floor(Math.random() * 360),
      handoffEnabled: item.handoffEnabled !== false,
      sessionMode: "new",
      sessionId: null,
      lastSessionId: null,
      status: "idle",
      artifacts: [],
      logs: [],
      lastRunId: null,
    };
    usedAgentIds.add(item.agent);
    byKey.set(item.key, node);
    nodes.push(node);
  }
  if (!nodes.length) return false;

  const edges = [];
  const seen = new Set();
  for (const item of preset.edges || []) {
    const from = byKey.get(item?.from);
    const to = byKey.get(item?.to);
    if (!from || !to || from === to) continue;
    const signature = `${from.id}->${to.id}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    edges.push({ id: rid("edge"), from: from.id, to: to.id, files: [] });
  }

  state.flows.push({
    id: rid("flow"),
    name: preset.name,
    nodes,
    edges,
    createdAt: now(),
    updatedAt: now(),
  });
  state.meta.seededPresets.push(key);
  return true;
}
