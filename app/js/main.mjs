import { request } from "./core/api.mjs";
import { esc } from "./core/dom.mjs";
import { createEvents } from "./core/events.mjs";
import { applyTranslations, t } from "./core/i18n.mjs";
import { mountShell } from "./shell.mjs";
import { mount as mountAgents } from "../../modules/agents/index.mjs";
import { mount as mountArtifacts } from "../../modules/artifacts/index.mjs";
import { mount as mountFlow } from "../../modules/flow/index.mjs";
import { mount as mountRuntime } from "../../modules/runtime/index.mjs";

async function boot() {
  applyTranslations();
  document.title = t("Pi Flow · 项目级 Agent 节点编排");
  const data = await request("/api/state");
  const events = createEvents();
  const shell = mountShell();
  const agents = await mountAgents({ events, request, initialAgents: data.agents });
  const artifacts = await mountArtifacts({ request });
  const flow = await mountFlow({ events, request, agents, artifacts, shell, initialFlows: data.flows });
  await mountRuntime({ events, request, agents, flow });
}

boot().catch((error) => {
  document.body.innerHTML = `<pre style="padding:20px;color:#ff7a7a">${esc(
    t("加载失败：{message}", { message: error.message }),
  )}</pre>`;
});
