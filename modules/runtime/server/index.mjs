import { t } from "../../../shared/messages.mjs";

const MAX_LOGS = 400;
const MAX_TRANSCRIPT_ENTRIES = 400;
const MAX_TRANSCRIPT_CHARS = 200_000;
const MAX_TRANSCRIPTS = 40;
export const MAX_RUNS = 200;

function timeLabel() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function makeLogger(run) {
  return (message) => {
    run.logs.push(`[${timeLabel()}] ${message}`);
    if (run.logs.length > MAX_LOGS) run.logs.splice(0, run.logs.length - MAX_LOGS);
  };
}

function buildPrompt({ task, handoffEnabled, workspace, files = [] }) {
  if (handoffEnabled === false) return task;
  const moved = files.length
    ? `\n\n上游移入的文件：\n${files.map((file) => `- ${file.name}`).join("\n")}`
    : "";
  return `${task}

工作区目录（直接在这里读写文件）：
${workspace}${moved}`;
}

export function createRuntimeServer({ store, agents, artifacts, pi, tools }) {
  if (!tools || typeof tools.resolve !== "function") {
    throw new Error("runtime 需要工具网关（tools.resolve）");
  }
  const { ApiError, db, now, rid, saveState } = store;
  const liveRuns = new Map();
  const transcripts = new Map();
  let recovered = false;

  function recordActivity(runId, activity) {
    let entries = transcripts.get(runId);
    if (!entries) {
      if (transcripts.size >= MAX_TRANSCRIPTS) transcripts.delete(transcripts.keys().next().value);
      entries = [];
      transcripts.set(runId, entries);
    }

    if (activity.kind === "thinking" || activity.kind === "text") {
      const last = entries[entries.length - 1];
      if (last?.type === activity.kind) {
        last.text += activity.delta;
        if (last.text.length > MAX_TRANSCRIPT_CHARS) last.text = last.text.slice(-MAX_TRANSCRIPT_CHARS);
      } else {
        entries.push({ type: activity.kind, text: activity.delta });
      }
      return;
    }

    if (activity.kind === "tool_start") {
      entries.push({
        type: "tool",
        toolCallId: activity.toolCallId,
        toolName: activity.toolName,
        args: activity.args,
        status: "running",
        isError: false,
        durationMs: null,
      });
    } else if (activity.kind === "tool_end") {
      let target = null;
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (entries[index].type === "tool" && entries[index].toolCallId === activity.toolCallId) {
          target = entries[index];
          break;
        }
      }
      if (!target) {
        target = { type: "tool", toolCallId: activity.toolCallId, toolName: activity.toolName, args: null };
        entries.push(target);
      }
      target.status = activity.isError ? "error" : "done";
      target.isError = Boolean(activity.isError);
      target.durationMs = Number.isFinite(activity.durationMs) ? activity.durationMs : null;
    }

    while (entries.length > MAX_TRANSCRIPT_ENTRIES) entries.shift();
  }

  for (const run of Object.values(db.state.runs)) {
    if (run.status !== "running") continue;
    run.status = "error";
    run.error = t("应用重启，上次运行已中断");
    run.finishedAt = now();
    run.logs ||= [];
    makeLogger(run)(t("应用重启，上次运行已中断"));
    recovered = true;
  }
  if (pruneRuns() > 0) recovered = true;

  /* 文件直接在各自 Agent 的工作区里移动，不再有流程目录。 */

  function runningRun(flowId, nodeId) {
    return (
      Object.values(db.state.runs).find(
        (run) => run.status === "running" && run.flowId === flowId && run.nodeId === nodeId,
      ) || null
    );
  }

  /* runId 只用于内存里的轮询 / 中止索引，不再对应磁盘目录。
   * 序号在内存里同步递增（并发启动不会拿到同一个），首次使用时从已有记录接上。 */
  let runSeq = null;
  function nextRunId() {
    if (runSeq === null) {
      runSeq = 0;
      for (const id of Object.keys(db.state.runs)) {
        const match = /^run-(\d+)$/.exec(id);
        if (match) runSeq = Math.max(runSeq, Number(match[1]));
      }
    }
    runSeq += 1;
    return `run-${String(runSeq).padStart(3, "0")}`;
  }

  /** 只清理已结束的旧 run；正在运行的和最新记录保留。返回删除数量。 */
  function pruneRuns() {
    const entries = Object.entries(db.state.runs);
    if (entries.length <= MAX_RUNS) return 0;
    const finished = entries
      .filter(([, run]) => run.status !== "running")
      .sort((a, b) => String(a[1].finishedAt || "").localeCompare(String(b[1].finishedAt || "")));
    let excess = entries.length - MAX_RUNS;
    let removed = 0;
    for (const [id] of finished) {
      if (excess <= 0) break;
      delete db.state.runs[id];
      transcripts.delete(id);
      excess -= 1;
      removed += 1;
    }
    return removed;
  }

  /* 运行记录只留在内存（state.json）里供轮询 / 恢复使用，不再写 run.json。 */

  async function start({ node, flowId, inputFiles = [] }) {
    if (!node?.agentId) throw new ApiError(400, t("节点缺少 agentId"));
    if (!flowId) throw new ApiError(400, t("缺少流程 id"));

    const task = String(node.task || "").trim();
    if (!task) throw new ApiError(400, t("节点任务为空"));

    const agent = agents.get(node.agentId);
    if (!agent) throw new ApiError(404, t("Agent 不存在"));
    if (runningRun(flowId, node.id)) throw new ApiError(409, t("节点正在运行"));

    const runId = nextRunId();
    /* 连线上选中的文件：从上游工作区移动到本节点的工作区（移动，不复制）。 */
    const inputs = await artifacts.moveInputs({ agent, files: inputFiles });
    if (runningRun(flowId, node.id)) throw new ApiError(409, t("节点正在运行"));
    const session = agents.beginSession(agent.id, node);

    const run = {
      id: runId,
      flowId: String(flowId),
      nodeId: node.id,
      nodeTitle: node.title,
      agentId: agent.id,
      sessionId: session.reused ? session.piSessionId : null,
      sessionFile: session.reused ? session.piSessionFile || null : null,
      sessionMode: node.sessionMode,
      status: "running",
      startedAt: now(),
      finishedAt: null,
      inputs,
      artifacts: [],
      logs: [],
      error: null,
    };
    db.state.runs[runId] = run;
    pruneRuns();

    function bindSession(piSessionId, piSessionFile) {
      if (!piSessionId && !piSessionFile) return;
      agents.bindSession(agent.id, session.internalId, piSessionId, piSessionFile);
      if (piSessionId) run.sessionId = piSessionId;
      if (piSessionFile) run.sessionFile = piSessionFile;
    }

    const log = makeLogger(run);
    log(t("pi 启动：cwd={path}", { path: agent.projectPath }));
    log(
      t("会话 {mode}", {
        mode: session.reused ? t("复用 {id}", { id: session.piSessionId }) : t("新建"),
      }),
    );
    log(t("移入 {n} 个上游文件", { n: inputs.length }));
    await saveState();

    const prompt = buildPrompt({
      task,
      handoffEnabled: node.handoffEnabled !== false,
      workspace: agent.projectPath,
      files: inputs,
    });
    const resources = tools.resolve(agent.projectPath);
    if (resources.noExtensions) {
      log(t("扩展隔离：--no-extensions，只加载 {n} 个项目扩展", { n: resources.extensions.length }));
    }
    const controller = pi.start({
      cwd: agent.projectPath,
      prompt,
      sessionId: session.reused ? session.piSessionId : null,
      noExtensions: resources.noExtensions,
      extensions: resources.extensions,
      env: {
        PI_FLOW_FLOW_ID: String(flowId),
        /* 没有 run 目录了：agent 直接在自己的工作区里读写。 */
        PI_FLOW_WORKSPACE: agent.projectPath,
        PI_FLOW_INPUT_DIR: agent.projectPath,
        PI_FLOW_OUTPUT_DIR: agent.projectPath,
      },
      timeoutMs: Number(process.env.PI_RUN_TIMEOUT_MS || 15 * 60_000),
      onLog: log,
      onActivity: (activity) => recordActivity(runId, activity),
      onSessionInfo: (info) => bindSession(info?.sessionId, info?.sessionFile),
      // 兼容只上报 sessionId 的旧实现 / 测试替身。
      onSessionId: (piSessionId) => bindSession(piSessionId, null),
    });
    liveRuns.set(runId, controller);

    controller.promise
      .then(async (result) => {
        if (result.text?.trim()) {
          log(t("回复：{text}", { text: result.text.trim().slice(0, 500) }));
        }
        /* 产物 = 这个 Agent 工作区里现有的文件，不再扫描 output 目录。 */
        run.artifacts = await artifacts.listFiles({ agentId: agent.id });
        run.status = "done";
        run.finishedAt = now();
        agents.finishSession(agent.id, session.internalId, run.artifacts.length);
        log(t("完成，工作区现有 {n} 个文件", { n: run.artifacts.length }));
      })
      .catch((error) => {
        run.status = "error";
        run.error = error.message;
        run.finishedAt = now();
        log(t("失败：{message}", { message: error.message }));
      })
      .finally(async () => {
        liveRuns.delete(runId);
        await saveState();
      });

    return { runId, sessionId: session.piSessionId, sessionInternalId: session.internalId };
  }

  function get(runId) {
    const run = db.state.runs[runId];
    if (!run) return null;
    return { ...run, transcript: transcripts.get(runId) || [] };
  }

  function abort(runId) {
    const run = get(runId);
    if (!run) throw new ApiError(404, t("Run 不存在"));
    const controller = liveRuns.get(runId);
    if (!controller) throw new ApiError(409, t("该运行已经结束"));
    controller.abort();
    return run;
  }

  /* 正在运行的节点：关窗前由主进程通过 /api/runs/active 来问，
   * 数据归 run 记录所有，不让窗口层去读内部状态。 */
  function active() {
    const runs = Object.values(db.state.runs)
      .filter((run) => run.status === "running")
      .map((run) => ({ id: run.id, flowId: run.flowId, nodeId: run.nodeId, nodeTitle: run.nodeTitle }));
    return { count: runs.length, runs };
  }

  return {
    recovered,
    api: { start, get, abort, active },
    routes: [
      {
        method: "POST",
        path: "/api/run",
        handler: ({ body }) => {
          if (!body.node?.agentId || !body.flowId) {
            throw new ApiError(400, t("缺少 node 或 flowId"));
          }
          return start({ node: body.node, flowId: body.flowId, inputFiles: body.inputFiles });
        },
      },
      {
        method: "GET",
        path: "/api/runs/active",
        handler: () => active(),
      },
      {
        method: "GET",
        pattern: /^\/api\/runs\/([^/]+)$/,
        handler: ({ params }) => {
          const run = get(params[1]);
          if (!run) throw new ApiError(404, t("Run 不存在"));
          return run;
        },
      },
      {
        method: "POST",
        pattern: /^\/api\/runs\/([^/]+)\/abort$/,
        handler: ({ params }) => {
          abort(params[1]);
          return { ok: true };
        },
      },
    ],
  };
}
