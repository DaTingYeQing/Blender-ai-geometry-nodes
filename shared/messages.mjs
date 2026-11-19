/**
 * 第二 / 三层共享文案：中文原文就是 key，英文缺失时自动回退中文。
 * 这里不碰 DOM；服务端和界面都只取 t() 的结果，界面再写进自己的节点。
 */
const STORAGE_KEY = "pi-flow-locale";

export const EN = {
  // 外壳 / 通用
  "Pi Flow · 项目级 Agent 节点编排": "Pi Flow · Project Agent Node Orchestration",
  "已保存": "Saved",
  "保存中…": "Saving…",
  "保存失败": "Save failed",
  "保存失败：{message}": "Save failed: {message}",
  "窗口控制": "Window controls",
  "界面语言": "Interface language",
  "最小化": "Minimize",
  "最大化 / 还原": "Maximize / Restore",
  "最大化或还原": "Maximize or restore",
  "关闭": "Close",
  "有节点正在运行": "A node is running",
  "警告：关闭窗口会中断正在运行的任务，并可能导致错误。":
    "Warning: closing the window will stop running tasks and may cause errors.",
  "还有 {n} 个节点在运行。": "{n} node(s) are still running.",
  "仍然关闭": "Close anyway",
  "继续等待": "Keep waiting",
  "加载流程…": "Loading flow…",
  "还没有流程": "No flows yet",
  "空": "Empty",
  "{name} · {n} 节点": "{name} · {n} nodes",
  "按钮区": "Button area",
  "凹槽区": "Groove area",
  "加载失败：{message}": "Failed to load: {message}",
  "请求失败（{status}）": "Request failed ({status})",
  "确认操作": "Confirm",
  "确认": "Confirm",
  "确定": "Confirm",
  "取消": "Cancel",

  // 界面通用
  "团队": "Agents",
  "语言": "Language",
  "工作区": "Workspace",
  "团队模式": "Team mode",
  "单人模式": "Solo mode",
  "单人模式下直接启动 Pi 终端，会话管理由 Pi 自己负责":
    "Solo mode launches the Pi terminal directly; Pi handles session management.",
  "添加": "Add",
  "删除": "Delete",
  "新建团队": "New agent",
  "注册agent": "Register agent",
  "项目文件夹的绝对路径": "Absolute path to the project folder",
  "选择": "Choose",
  "重命名": "Rename",

  // 卡片
  "打开目录": "Open folder",
  "重命名对话": "Rename session",
  "删除对话": "Delete session",
  "在这里输入…": "Type here…",
  "给下游节点输入任务…": "Task for the downstream node…",
  "运行": "Run",
  "中止运行": "Stop run",
  "读取上游": "Read",
  "不读取": "Skip",
  "新建对话": "New",
  "复用对话": "Reuse",
  "查看对话": "View session",
  "选择要复用的对话": "Choose a session to reuse",
  "选择对话": "Choose a session",
  "确认并退出": "Confirm and exit",
  "产物": "Artifacts",
  "暂无对话": "No sessions yet",
  "未命名对话": "Untitled session",
  "正在启动…": "Starting…",
  "运行中": "Running",
  "完成": "Done",
  "失败": "Failed",
  "选择一段对话查看内容": "Choose a session to view",
  "加载中…": "Loading…",
  "这段对话还没有落盘内容。": "This session has no saved content yet.",
  "暂无内容": "No content",
  "还没有产物": "No artifacts yet",
  "[工具]": "[Tool]",
  "这个文件类型不支持预览": "Preview is not supported for this file type",
  "当前在浏览器里，只有桌面版能打开目录": "Only the desktop app can open folders.",
  "当前在浏览器里，请直接粘贴项目文件夹的绝对路径":
    "Paste the absolute project folder path (browser preview).",

  // 保存
  "保存": "Save",
  "成功": "Done",
  "保存流程": "Save flow",
  "有未保存的改动": "Unsaved changes",
  "保存失败": "Save failed",
  "保存失败，先别离开": "Save failed; staying in the workspace",
  "保存失败，窗口先不关": "Save failed; the window will stay open",
  "还有节点在运行": "Nodes are still running",
  "现在关闭会中断 {n} 个正在运行的任务，并可能导致错误。":
    "Closing now will interrupt {n} running task(s) and may cause errors.",
  "还有改动没保存": "Unsaved changes",
  "离开工作区前，要先保存这个流程吗？":
    "Save this flow before leaving the workspace?",
  "当前流程有改动还没保存，要先保存吗？":
    "This flow has unsaved changes. Save before exiting?",
  "保存并关闭": "Save and close",
  "不保存": "Don't save",
  "保存并离开": "Save and leave",
  "切换语言要先处理未保存的改动": "Save before switching language",
  "界面会重新加载，未保存的改动会丢失。":
    "The UI will reload and unsaved changes will be lost.",
  "保存并切换": "Save and switch",
  "直接切换": "Switch anyway",

  // 前端校验
  "未知语言：{lang}": "Unknown language: {lang}",
  "未知模式：{mode}": "Unknown mode: {mode}",
  "请先选择项目文件夹": "Choose a project folder first",
  "缺少 Agent 或对话": "Missing agent or session",
  "节点不存在": "Node not found",
  "请先填写任务，再运行": "Fill in the task before running",
  "请先选择一个工作区": "Choose a workspace first",
  "同一个团队之间不能相互连接": "Nodes from the same agent cannot be connected",
  "起点节点不存在": "Source node not found",
  "未知面板：{id}": "Unknown panel: {id}",
  "当前没有可操作的对话": "No session available to edit",
  "找不到这段对话": "Session not found",
  "对话行不在页面上": "The session row is no longer on the page",

  // Agent 面板
  "AGENT / 清单": "AGENT / LIST",
  "新建 Agent": "New Agent",
  "注册项目级 Agent": "Register Project Agent",
  "名称": "Name",
  "例如：接口实现": "e.g. API implementation",
  "项目路径（绝对路径）": "Project path (absolute)",
  "C:/Users/你/Desktop/project": "C:/Users/you/Desktop/project",
  "浏览…": "Browse…",
  "运行时以这个路径作为 <code>pi --mode rpc</code> 的 cwd，自动继承项目级 <code>.pi</code> 配置。产物写到项目内的 <code>.pi/flow/&lt;flowId&gt;/runs/&lt;runId&gt;/output</code>。":
    "The runtime uses this path as the cwd for <code>pi --mode rpc</code> and inherits the project-level <code>.pi</code> config. Artifacts are written to <code>.pi/flow/&lt;flowId&gt;/runs/&lt;runId&gt;/output</code> inside the project.",
  "注册": "Register",
  "Agent 已注册，可以拖到画布了": "Agent registered. Drag it onto the canvas.",
  "删除 Agent": "Delete Agent",
  "确定删除「{name}」吗？": "Delete “{name}”?",
  "只删除注册记录，不会删除项目目录或已有会话。": "Only the registration is removed. The project folder and existing sessions are kept.",
  "删除": "Delete",
  "已删除「{name}」": "Deleted “{name}”",
  "已选中「{name}」": "Selected “{name}”",
  "已删除节点「{name}」": "Deleted node “{name}”",
  "已删除流程": "Flow deleted",
  "删除失败：{message}": "Delete failed: {message}",
  "正在启动…": "Starting…",
  "已在终端启动 {agent}": "Launched {agent} in a terminal",
  "启动失败：{message}": "Launch failed: {message}",
  "还没有注册 Agent。<br />点下方「新建 Agent」添加一个真实项目目录。": "No agents registered yet.<br />Click “New Agent” below to add a real project folder.",
  "{n} 会话": "{n} sessions",
  "运行日志（静态占位）": "Run log (static placeholder)",
  "RUN LOG / 今日": "RUN LOG / TODAY",
  "执行者 / OK": "EXECUTOR / OK",
  "侦察者 / OK": "SCOUT / OK",
  "翻译者 / FAIL · 超时": "TRANSLATOR / FAIL · TIMEOUT",

  // 画布 / 流程启动器
  "把左侧 Agent 拖到这里": "Drag an Agent here from the left",
  "按住 Alt 从节点拖到另一个节点，建立连线": "Hold Alt and drag from one node to another to create a link",
  "新建流程": "New Flow",
  "工作区": "Workspace",
  "选择模式": "Choose Mode",
  "团队": "Team",
  "单人": "Solo",
  "流程": "Flow",
  "{n} 个": "{n}",
  "流程名称": "Flow name",
  "创建": "Create",
  "单人模式会在外部终端启动 <code>GEO_Single</code>；新建或继续历史会话由 pi 自己管理，Pi Flow 不会关闭。":
    "Solo mode launches <code>GEO_Single</code> in an external terminal. pi manages new or resumed sessions itself; Pi Flow stays open.",
  "确定": "OK",
  "还没有流程。在下面创建一个。": "No flows yet. Create one below.",
  "{nodes} 节点 · {edges} 连线": "{nodes} nodes · {edges} links",
  "删除流程": "Delete flow",
  "确定删除流程「{name}」吗？": "Delete flow “{name}”?",
  "该流程在各 Agent 项目下的 <code>.pi/flow/&lt;flowId&gt;</code> 工作区（inputs / output）会一并删除，无法恢复。":
    "The flow's <code>.pi/flow/&lt;flowId&gt;</code> workspace (inputs / output) in every Agent project will also be deleted. This cannot be undone.",
  "确认删除": "Delete",
  "有节点正在运行，结束后再删除流程": "A node is running. Stop it before deleting the flow.",
  "有节点正在运行，结束后再切换流程": "A node is running. Stop it before switching flows.",
  "有节点正在运行，结束后再新建流程": "A node is running. Stop it before creating a flow.",
  "已在外部终端启动 GEO_Single": "Launched GEO_Single in an external terminal",
  "浏览器调试模式无法打开文件管理器": "The file manager is unavailable in browser dev mode",

  // 检查器
  "节点": "Node",
  "新节点": "New node",
  "已新建「{name}」": "Created \"{name}\"",
  "未知": "Unknown",
  "项目": "Project",
  "任务 / Prompt": "Task / Prompt",
  "描述这个节点要做什么。可以引用上游产物路径。": "Describe what this node should do. You can reference upstream artifact paths.",
  "交接提示词": "Handoff prompt",
  "开启后，运行时会在任务后面附上本次上游 inputs 的绝对路径":
    "When enabled, the runtime appends the absolute paths of this run's upstream inputs to the task.",
  "会话": "Session",
  "会话记录": "Session Log",
  "新对话": "New chat",
  "复用历史对话": "Resume chat",
  "{n} 条": "{n} msgs",
  "暂无历史会话": "No past sessions",
  "输入文件（来自连线）": "Input files (from links)",
  "中止运行": "Stop run",
  "▶ 运行节点": "▶ Run node",
  "产物": "Artifacts",
  "{n} 个文件": "{n} files",
  "预览": "Preview",
  "产物 0 个文件<br />运行后在这里看到产物": "No artifacts yet<br />Run the node to see artifacts here",
  "连线": "Link",
  "从上游产物中显式勾选要传递的文件。下游运行时会把它们复制到本次 run 的 <code>inputs/</code>。":
    "Select the upstream artifacts to pass along. The downstream run copies them into this run's <code>inputs/</code>.",
  "上游产物": "Upstream artifacts",
  "上游还没有产物。先运行上游节点。": "No upstream artifacts yet. Run the upstream node first.",
  "全选": "Select all",
  "清空": "Clear",
  "已选": "Selected",
  "删除连线": "Delete link",
  "连线已删除": "Link deleted",

  // 节点 / 连线
  "运行节点": "Run node",
  "入 {in} · 出 {out}": "In {in} · Out {out}",
  "已选 {n} 个文件 · 节点之间用文件的形式传话": "{n} files selected · nodes communicate through files",
  "未选择文件 · 节点之间用文件的形式传话": "No files selected · nodes communicate through files",
  "已添加「{name}」节点": "Added “{name}” node",
  "删除节点": "Delete Node",
  "节点上的任务和连线会一起删除。": "The node's task and links will also be deleted.",
  "不能连接到自身": "A node cannot link to itself",
  "这条连线已存在": "This link already exists",
  "连线已创建，运行上游后在这里选择文件": "Link created. Run the upstream node, then pick files here.",

  // 会话记录
  "思考": "Thinking",
  "运行中": "Running",
  "失败": "Failed",
  "完成": "Done",
  "未运行": "Idle",
  "已完成": "Done",
  "未命名节点": "Untitled node",
  "{title} · 会话": "{title} · Session",
  "会话已启动，等待模型输出…": "Session started, waiting for model output…",
  "还没有会话内容。运行节点后，这里会实时显示思考、输出和工具调用。":
    "No session content yet. Run the node to see thinking, output, and tool calls here in real time.",

  // 工作区弹窗
  "Solo 工作区": "Solo Workspace",
  "Team 工作区": "Team Workspace",
  "请及时清理工作区，最好一次任务完成后清理一次。":
    "Please clean up the workspace promptly — ideally after every completed task.",
  "请及时清理工作区文件，推荐一次任务完成清理一次，否则可能会影响到下次任务的进行":
    "Clean up workspace files promptly — preferably after each task — otherwise it may affect the next task.",
  "打开工作区文件夹": "Open workspace folder",
  "Solo 工作区由运行环境的 <code>workspace.root</code> 动态解析。":
    "The Solo workspace is resolved dynamically from the runtime's <code>workspace.root</code>.",
  "工作区是 Agent 注册时填写的项目目录；运行产物在项目下的 <code>.pi/flow/&lt;flowId&gt;/runs/</code>。":
    "Workspaces are the project folders registered for each Agent. Run artifacts live under <code>.pi/flow/&lt;flowId&gt;/runs/</code> in each project.",
  "还没有注册 Agent。": "No agents registered.",
  "浏览": "Browse",
  "正在读取 Solo 工作区…": "Loading Solo workspace…",
  "浏览器调试模式无法解析 Solo 工作区，请用桌面端打开。":
    "Solo workspace is unavailable in browser dev mode. Open the desktop app.",

  // 运行控制
  "节点正在运行": "The node is already running",
  "Agent 不存在": "Agent not found",
  "「{name}」产出 {n} 个文件": "“{name}” produced {n} files",
  "运行失败": "Run failed",
  "已启动运行": "Run started",
  "运行失败：{message}": "Run failed: {message}",
  "轮询超时": "Timed out waiting for the run",
  "这个节点当前没有运行中的任务": "This node has no active run",
  "已请求中止": "Stop requested",

  // 产物预览
  "产物预览": "Artifact Preview",
  "无法读取": "Unable to read",

  // 服务端 / 主进程
  "项目路径不能为空": "Project path is required",
  "项目路径必须是绝对路径，例如 C:\\Users\\你\\Desktop\\项目":
    "Project path must be absolute, e.g. C:\\Users\\you\\Desktop\\project",
  "项目路径不存在：{path}": "Project path does not exist: {path}",
  "项目路径不是目录：{path}": "Project path is not a folder: {path}",
  "Agent 名称不能为空": "Agent name is required",
  "路径不允许": "Path not allowed",
  "文件不存在": "File not found",
  "不是文件": "Not a file",
  "（文件过大，原型中不展示）": "(File too large to display in this prototype)",
  "默认流程": "Default Flow",
  "未命名流程": "Untitled Flow",
  "流程 {n}": "Flow {n}",
  "流程不存在": "Flow not found",
  "应用重启，上次运行已中断": "App restarted; the previous run was interrupted",
  "超时（{s}s），已终止": "Timed out after {s}s; process terminated",
  "运行超时（{s} 秒）": "Run timed out after {s}s",
  "prompt 被拒绝": "Prompt rejected",
  "扩展请求 {method}（原型中自动取消）": "Extension request {method} (auto-cancelled in this prototype)",
  "扩展请求 {method}（原型中自动忽略）": "Extension request {method} (ignored in this prototype)",
  "非 JSON 输出：{text}": "Non-JSON output: {text}",
  "无法启动 pi：{message}（{bin}）": "Cannot start pi: {message} ({bin})",
  "信号 {signal}": "signal {signal}",
  "退出码 {code}": "exit code {code}",
  "pi 提前退出（{reason}）": "pi exited early ({reason})",
  "收到中止请求": "Abort requested",
  "运行已中止": "Run aborted",
  "节点缺少 agentId": "Node is missing agentId",
  "缺少流程 id": "Missing flow id",
  "节点任务为空": "Node task is empty",
  "pi 启动：cwd={path}": "pi started: cwd={path}",
  "会话 {mode}": "Session {mode}",
  "复用 {id}": "resumed {id}",
  "新建": "new",
  "输入 {n} 个文件 → 输出到 {dir}": "Input {n} files → output to {dir}",
  "扩展隔离：--no-extensions，只加载 {n} 个项目扩展":
    "Extension isolation: --no-extensions, loading only {n} project extensions",
  "回复：{text}": "Reply: {text}",
  "完成，收集到 {n} 个产物": "Done, collected {n} artifacts",
  "失败：{message}": "Failed: {message}",
  "Run 不存在": "Run not found",
  "该运行已经结束": "This run has already finished",
  "缺少 node 或 flowId": "Missing node or flowId",
  "请求体过大": "Request body too large",
  "请求体不是合法 JSON": "Request body is not valid JSON",
  "请求体": "Request body",
  "查询参数": "Query parameters",
  "{label}必须是对象": "{label} must be an object",
  "缺少字段 {name}": "Missing field {name}",
  "字段 {name} 应为 {type}": "Field {name} must be a {type}",
  "接口契约格式不正确": "Invalid API contract",
  "接口契约缺少 {id}": "The API contract is missing {id}",
  "接口 {id} 没有可构造的路径": "Endpoint {id} has no constructible path",
  "接口 {id} 缺少参数 {name}": "Endpoint {id} is missing parameter {name}",
  "单人模式目前只支持 Windows": "Solo mode currently supports Windows only",
  "找不到 GEO_Single：{path}": "GEO_Single not found: {path}",
  "找不到 node.exe，无法在外部终端启动单人模式。请重新运行安装程序修复运行环境。":
    "node.exe not found; cannot launch Solo mode in an external terminal. Rerun the installer to repair the runtime.",
  "选择项目目录": "Choose Project Folder",
  "Agent 未配置项目路径": "Agent has no project path",
  "工作区不是目录：{path}": "Workspace is not a folder: {path}",
  "工作区不存在：{path}": "Workspace does not exist: {path}",
  "Solo 工作区不是目录：{path}": "Solo workspace is not a folder: {path}",
  "无法准备 Solo 工作区：{path}（{message}）": "Cannot prepare Solo workspace: {path} ({message})",

  // 安装向导 / 主进程
  "Pi Flow 运行环境": "Pi Flow Runtime",
  "Pi Flow 启动失败": "Pi Flow failed to start",
  "启动日志：{path}": "Startup log: {path}",
  "打开日志文件夹": "Open Log Folder",
  "安装还没完成，确定要退出吗？": "Installation is not finished. Quit anyway?",
  "下次启动会从上次的进度继续。": "The next launch will resume where it left off.",
  "退出": "Quit",
  "继续等待": "Keep Waiting",
  "正在检查运行环境…": "Checking runtime…",
  "运行环境就绪，正在启动…": "Runtime ready, starting…",
  "没有加载默认预设：{message}": "Default preset not loaded: {message}",
  "已准备 {n} 个 agent": "Prepared {n} agents",
  "找不到安装脚本：{path}": "Setup script not found: {path}",
  "找不到地址簿模板：{path}": "Environment template not found: {path}",
  "安装包缺少 Blender：{path}": "The installer is missing Blender: {path}",
  "安装包缺少 CovTrace 工具链：{path}":
    "The installer is missing the CovTrace toolchain: {path}",
  "安装脚本异常退出（代码 {code}）": "Setup script exited unexpectedly (code {code})",
  "安装完成，但运行时文件仍不完整": "Setup finished, but the runtime is still incomplete",
  "找不到 agent 模板：{path}": "Agent templates not found: {path}",
  "同步 agent 配置失败（退出码 {code}）{tail}": "Failed to sync agent configuration (exit code {code}){tail}",
  "预览模式：不会执行真实安装。": "Preview mode: no real installation is performed.",
  "运行环境就绪（预览）。": "Runtime ready (preview).",
};

function readStored() {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

/** 浏览器首次进入默认英文；Node 端（测试、服务端）保持中文，等请求头再切。 */
export function resolveLocale(stored, browser = typeof document !== "undefined") {
  if (stored === "zh" || stored === "en") return stored;
  return browser ? "en" : "zh";
}

let locale = resolveLocale(readStored());

export function getLocale() {
  return locale;
}

export function setLocale(next) {
  locale = next === "en" ? "en" : "zh";
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale);
  } catch {
    // Node 端没有 localStorage。
  }
}

/** 中文原文即 key；英文缺失时回退中文。{name} 形式做占位替换。 */
export function t(text, vars) {
  const template = locale === "en" ? EN[text] ?? text : text;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}
