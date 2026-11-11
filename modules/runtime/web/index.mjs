import { sleep } from "../../../app/js/core/dom.mjs";
import { EVENTS } from "../../../app/js/core/events.mjs";
import { t } from "../../../app/js/core/i18n.mjs";
import { toast } from "../../../app/js/core/toast.mjs";

const POLL_MS = 400;
const MAX_POLL_MS = 30 * 60_000;

export function mountRuntime({ events, request, agents, flow }) {
  function update(node, patch) {
    events.emit(EVENTS.RUN_CHANGED, { nodeId: node.id, ...patch });
  }

  async function executeNode(node) {
    if (node.status === "running") {
      toast(t("节点正在运行"), true);
      return false;
    }
    const agent = agents.get(node.agentId);
    if (!agent) {
      toast(t("Agent 不存在"), true);
      return false;
    }

    const inputFiles = flow.collectInputs(node);
    update(node, { status: "running", select: true, transcript: [] });

    try {
      const { runId, sessionInternalId } = await request("/api/run", {
        method: "POST",
        body: JSON.stringify({
          node,
          flowId: flow.currentId(),
          inputFiles: inputFiles.map((file) => ({ name: file.name, path: file.path })),
        }),
      });
      update(node, { runId, sessionInternalId });

      const startedAt = Date.now();
      while (Date.now() - startedAt < MAX_POLL_MS) {
        await sleep(POLL_MS);
        const run = await request(`/api/runs/${encodeURIComponent(runId)}`);
        update(node, { progress: true, transcript: run.transcript || [] });

        if (run.status === "done") {
          update(node, {
            status: "done",
            run,
            sessionInternalId,
            transcript: run.transcript || [],
          });
          try {
            await agents.reload();
          } catch {
            // 刷新会话列表失败不影响本次结果。
          }
          toast(t("「{name}」产出 {n} 个文件", { name: node.title, n: node.artifacts.length }));
          return true;
        }

        if (run.status === "error") {
          update(node, { status: "error", transcript: run.transcript || [] });
          toast(run.error || t("运行失败"), true);
          return false;
        }
      }

      update(node, { status: "error" });
      toast(t("轮询超时"), true);
      return false;
    } catch (error) {
      update(node, { status: "error" });
      toast(error.message, true);
      return false;
    }
  }

  async function abortNode(node) {
    if (!node.lastRunId || node.status !== "running") {
      toast(t("这个节点当前没有运行中的任务"), true);
      return;
    }
    try {
      await request(`/api/runs/${encodeURIComponent(node.lastRunId)}/abort`, { method: "POST" });
      toast(t("已请求中止"));
    } catch (error) {
      toast(error.message, true);
    }
  }

  events.on(EVENTS.RUN_REQUEST, ({ nodeId }) => {
    const node = flow.nodeOf(nodeId);
    if (node) executeNode(node);
  });
  events.on(EVENTS.RUN_ABORT, ({ nodeId }) => {
    const node = flow.nodeOf(nodeId);
    if (node) abortNode(node);
  });
}
