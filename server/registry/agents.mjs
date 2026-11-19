import path from "node:path";

function normalized(value) {
  const abs = path.resolve(String(value || ""));
  return process.platform === "win32" ? abs.toLowerCase() : abs;
}

function samePath(a, b) {
  return normalized(a) === normalized(b);
}

/**
 * 把清单里的模板对账到 state.agents。
 *
 * 语义：
 *   - 已播种过的项目被用户删掉后不复活（meta.seededAgents）；
 *   - 清单里的路径/显示名变了，已登记的 Agent 跟着更新，不再沿用旧路径；
 *   - 用户改过名字的 Agent 不被模板名覆盖；
 *   - register:false（单人模式）误注册且没有被流程引用时清理掉。
 *
 * 返回 { changed, report }；report 给启动日志和诊断用。
 */
export function reconcileAgents(state, templates, { rid, now } = {}) {
  if (!state || typeof state !== "object") throw new Error("reconcileAgents 需要 state");
  if (!Array.isArray(templates)) throw new Error("reconcileAgents 需要 templates 数组");
  if (typeof rid !== "function" || typeof now !== "function") {
    throw new Error("reconcileAgents 需要 store.rid 与 store.now");
  }

  state.agents = Array.isArray(state.agents) ? state.agents : [];
  state.meta = state.meta && typeof state.meta === "object" ? state.meta : {};
  state.meta.seededAgents = Array.isArray(state.meta.seededAgents) ? state.meta.seededAgents : [];

  const seeded = new Set(state.meta.seededAgents);
  const referenced = new Set(
    (Array.isArray(state.flows) ? state.flows : []).flatMap((flow) =>
      (flow.nodes || []).map((node) => node.agentId),
    ).filter(Boolean),
  );
  const report = { added: [], updated: [], removed: [], skipped: [] };
  let changed = false;

  // 旧数据没有 templateKey：按路径补上，后面才能按项目对账。
  for (const agent of state.agents) {
    if (agent.templateKey) continue;
    const match = templates.find(
      (template) => template.register !== false && samePath(template.projectPath, agent.projectPath),
    );
    if (!match) continue;
    agent.templateKey = match.project;
    if (agent.name === match.name) agent.templateName = match.name;
    report.updated.push({ project: match.project, reason: "补登记" });
    changed = true;
  }

  // register:false 的项目不注册成可拖拽 Agent。
  for (const template of templates.filter((item) => item.register === false)) {
    for (let index = state.agents.length - 1; index >= 0; index -= 1) {
      const agent = state.agents[index];
      const matches =
        agent.templateKey === template.project || samePath(agent.projectPath, template.projectPath);
      if (!matches) continue;
      if (referenced.has(agent.id)) {
        report.skipped.push({ project: template.project, reason: "被流程引用，保留" });
        continue;
      }
      if (!seeded.has(template.project) && agent.templateKey !== template.project) {
        report.skipped.push({ project: template.project, reason: "不是模板登记的 Agent，保留" });
        continue;
      }
      state.agents.splice(index, 1);
      report.removed.push({ project: template.project, agentId: agent.id });
      changed = true;
    }
  }

  for (const template of templates.filter((item) => item.register !== false)) {
    let agent = state.agents.find((item) => item.templateKey === template.project);
    if (!agent) {
      agent = state.agents.find(
        (item) => !item.templateKey && samePath(item.projectPath, template.projectPath),
      );
      if (agent) {
        agent.templateKey = template.project;
        if (agent.name === template.name) agent.templateName = template.name;
        report.updated.push({ project: template.project, reason: "补登记" });
        changed = true;
      }
    }

    if (agent) {
      const nextPath = path.resolve(template.projectPath);
      if (!samePath(agent.projectPath, nextPath)) {
        const previous = agent.projectPath;
        agent.projectPath = nextPath;
        report.updated.push({
          project: template.project,
          reason: "路径更新",
          from: previous,
          to: nextPath,
        });
        changed = true;
      }

      if (
        agent.templateName &&
        agent.name === agent.templateName &&
        agent.name !== template.name
      ) {
        agent.name = template.name;
        agent.templateName = template.name;
        report.updated.push({ project: template.project, reason: "名称更新" });
        changed = true;
      } else if (!agent.templateName && agent.name === template.name) {
        agent.templateName = template.name;
        changed = true;
      }

      if (!seeded.has(template.project)) {
        seeded.add(template.project);
        state.meta.seededAgents.push(template.project);
        changed = true;
      }
      continue;
    }

    if (seeded.has(template.project)) {
      report.skipped.push({ project: template.project, reason: "用户已删除，不复活" });
      continue;
    }

    state.agents.push({
      id: rid("agent"),
      name: template.name,
      projectPath: path.resolve(template.projectPath),
      templateKey: template.project,
      templateName: template.name,
      createdAt: now(),
      sessions: [],
    });
    seeded.add(template.project);
    state.meta.seededAgents.push(template.project);
    report.added.push({ project: template.project });
    changed = true;
  }

  return { changed, report };
}

/** 兼容旧调用：只关心有没有变化。 */
export function seedAgents(state, templates, store) {
  return reconcileAgents(state, templates, store).changed;
}
