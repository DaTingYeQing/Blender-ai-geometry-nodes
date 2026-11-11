import path from "node:path";

/**
 * 首次安装时把模板 agent 写入应用状态。
 * meta.seededAgents 记录已经播种过的项目，避免用户删除后重启又自动加回来。
 * register: false 的项目（单人模式）只同步配置，不注册成可拖拽的 Agent；
 * 之前版本误注册的，若没有流程引用则顺手清理掉。
 */
export function seedAgents(state, templates, { rid, now }) {
  state.agents ||= [];
  state.meta ||= {};
  state.meta.seededAgents ||= [];

  const seeded = new Set(state.meta.seededAgents);
  const known = new Set(state.agents.map((agent) => path.resolve(agent.projectPath || "")));
  const knownNames = new Set(state.agents.map((agent) => agent.name));
  const referenced = new Set(
    (state.flows || []).flatMap((flow) => (flow.nodes || []).map((node) => node.agentId)).filter(Boolean),
  );
  let changed = false;

  for (const template of templates) {
    if (!template?.project || !template?.projectPath) continue;

    if (template.register === false) {
      if (!seeded.has(template.project)) continue;
      const target = path.resolve(template.projectPath);
      for (let i = state.agents.length - 1; i >= 0; i--) {
        const agent = state.agents[i];
        if (path.resolve(agent.projectPath || "") !== target) continue;
        if (referenced.has(agent.id)) continue;
        state.agents.splice(i, 1);
        known.delete(target);
        knownNames.delete(agent.name);
        changed = true;
      }
      continue;
    }

    if (seeded.has(template.project)) continue;

    seeded.add(template.project);
    state.meta.seededAgents.push(template.project);
    changed = true;

    const name = template.name || template.project;
    const projectPath = path.resolve(template.projectPath);
    if (known.has(projectPath) || knownNames.has(name)) continue;
    state.agents.push({
      id: rid("agent"),
      name,
      projectPath,
      createdAt: now(),
      sessions: [],
    });
    known.add(projectPath);
    knownNames.add(name);
  }

  return changed;
}
