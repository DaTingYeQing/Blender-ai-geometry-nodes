/**
 * 第二 / 三层共享文案：中文原文就是 key，英文缺失时自动回退中文。
 * 这里不碰 DOM；服务端和界面都只取 t() 的结果，界面再写进自己的节点。
 */
const STORAGE_KEY = "pi-flow-locale";

export const EN = {
  // 外壳 / 通用
  "最小化": "Minimize",
  "最大化 / 还原": "Maximize / Restore",
  "关闭": "Close",
  "仍然关闭": "Close anyway",
  "请求失败（{status}）": "Request failed ({status})",
  "取消": "Cancel",
  "设置": "Settings",
  "Agent 配置": "Agent configuration",
  "对话框": "Dialog",
  "关闭提示": "Dismiss notification",
  "此区域暂时不可用": "This area is temporarily unavailable",
  "侧栏暂时不可用": "The sidebar is temporarily unavailable",
  "画布暂时不可用": "The canvas is temporarily unavailable",
  "产物查看器暂时不可用": "The artifact viewer is temporarily unavailable",

  // 界面通用
  "语言": "Language",
  "团队模式": "Team mode",
  "单人模式": "Solo mode",
  "单人模式下直接启动 Pi 终端，会话管理由 Pi 自己负责":
    "Solo mode launches the Pi terminal directly; Pi handles session management.",
  "添加": "Add",
  "新建团队": "New agent",
  "注册agent": "Register agent",
  "项目文件夹的绝对路径": "Absolute path to the project folder",
  "选择": "Choose",
  "重命名": "Rename",

  // Agent 配置面板
  "新建agent": "New agent",
  "配置现有agent": "Existing agent",
  "名称": "Name",
  "给这个 agent 起个名字": "Give this agent a name",
  "工具（可多选）": "Tools (multi-select)",
  "请先填写 Agent 名称": "Enter an agent name first",
  "请先选择一个 agent": "Choose an agent first",
  "还没有注册 agent": "No agents registered yet",
  "没有可用工具": "No tools available",
  "已创建 {name}": "Created {name}",
  "已保存": "Saved",
  "工具列表必须是数组": "Tools must be an array",
  "无法为 Agent 分配目录：{path}": "Cannot allocate a folder for the agent: {path}",
  "几何探针": "Geometry probe",
  "Python 执行": "Run Python",
  "运行脚本": "Run script",
  "节点构建": "Build nodes",
  "数据对比": "Data diff",
  "曲线拟合": "Curve fitting",
  "公式生成": "Generate from formula",
  "场景快照": "Scene snapshot",
  "节点查询": "Node lookup",
  "网格探针": "Mesh probe",
  "覆盖率追踪": "Coverage trace",
  "工作流规划": "Workflow planning",
  "技能注入": "Skill injection",

  // 卡片
  "打开目录": "Open folder",
  "重命名对话": "Rename session",
  "删除对话": "Delete session",
  "在这里输入…": "Type here…",
  "给下游节点输入任务…": "Task for the downstream node…",
  "运行": "Run",
  "看一下工作区": "View workspace",
  "不读取": "Skip",
  "新建对话": "New",
  "复用对话": "Reuse",
  "查看对话": "View session",
  "选择要复用的对话": "Choose a session to reuse",
  "选择对话": "Choose a session",
  "确认并退出": "Confirm and exit",
  "暂无对话": "No sessions yet",
  "未命名对话": "Untitled session",
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
  "语言切换失败": "Failed to switch language",
  "暂时无法离开工作区": "Cannot leave the workspace right now",
  "网络连接异常，请检查网络后重试。": "Network error. Check your connection and try again.",
  "请求超时，请稍后重试。": "Request timed out. Try again later.",
  "没有权限或登录已失效，请重新登录。": "No permission or your session has expired. Sign in again.",
  "服务器暂时不可用，请稍后重试。": "The server is temporarily unavailable. Try again later.",
  "操作失败，请稍后重试。": "The operation failed. Try again later.",
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

  // 前端校验
  "未知语言：{lang}": "Unknown language: {lang}",
  "未知模式：{mode}": "Unknown mode: {mode}",
  "请先选择项目文件夹": "Choose a project folder first",
  "缺少 Agent 或对话": "Missing agent or session",
  "节点不存在": "Node not found",
  "团队不存在": "Team not found",
  "连线不存在": "Edge not found",
  "坐标不合法": "Invalid coordinates",
  "运行控制器未接线": "The run controller is not wired",
  "请先填写任务，再运行": "Fill in the task before running",
  "请先选择一个工作区": "Choose a workspace first",
  "同一个团队之间不能相互连接": "Nodes from the same agent cannot be connected",
  "起点节点不存在": "Source node not found",
  "未知面板：{id}": "Unknown panel: {id}",
  "当前没有可操作的对话": "No session available to edit",
  "找不到这段对话": "Session not found",
  "对话行不在页面上": "The session row is no longer on the page",

  // Agent 面板
  "删除": "Delete",
  "正在启动…": "Starting…",

  // 画布 / 流程启动器
  "工作区": "Workspace",
  "团队": "Team",
  "确定": "OK",

  // 检查器
  "中止运行": "Stop run",
  "产物": "Artifacts",

  // 会话记录
  "运行中": "Running",
  "失败": "Failed",
  "完成": "Done",

  // 工作区弹窗
  "还没有工作区": "No workspaces yet",
  "请及时清理工作区文件，推荐一次任务完成清理一次，否则可能会影响到下次任务的进行":
    "Clean up workspace files promptly — preferably after each task — otherwise it may affect the next task.",
  "打开工作区文件夹": "Open workspace folder",

  // 运行控制
  "节点正在运行": "The node is already running",
  "Agent 不存在": "Agent not found",

  // 服务端 / 主进程
  "项目路径不能为空": "Project path is required",
  "项目路径必须是绝对路径，例如 C:\\Users\\你\\Desktop\\项目":
    "Project path must be absolute, e.g. C:\\Users\\you\\Desktop\\project",
  "项目路径不存在：{path}": "Project path does not exist: {path}",
  "项目路径不是目录：{path}": "Project path is not a folder: {path}",
  "Agent 名称不能为空": "Agent name is required",
  "会话不存在": "Session not found",
  "会话名称不能为空": "Session name is required",
  "缺少 Agent": "Missing agent id",
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
  "非 JSON 输出：{text}": "Non-JSON output: {text}",
  "无法启动 pi：{message}（{bin}）": "Cannot start pi: {message} ({bin})",
  "信号 {signal}": "signal {signal}",
  "退出码 {code}": "exit code {code}",
  "pi 提前退出（{reason}）": "pi exited early ({reason})",
  "收到中止请求": "Abort requested",
  "运行已中止": "Run aborted",
  "单人模式路径尚未就绪": "Solo mode path is not ready yet",
  "没有加载默认预设": "Default preset not loaded",
  "获取会话状态超时，直接发送任务": "Timed out getting session state; sending the task directly",
  "获取会话状态失败：{message}": "Failed to get session state: {message}",
  "中止失败：{message}": "Abort failed: {message}",
  "任务已排队，等待 agent_settled": "Task queued; waiting for agent_settled",
  "未知 disposition：{value}，继续等待 agent_settled":
    "Unknown disposition: {value}; waiting for agent_settled",
  "本轮结束，pi 将自动重试": "Turn ended; pi will retry automatically",
  "压缩上下文（{reason}）": "Compacting context ({reason})",
  "压缩失败：{message}": "Compaction failed: {message}",
  "压缩完成": "Compaction complete",
  "自动重试 {attempt}/{max}（{delay}ms）": "Auto retry {attempt}/{max} ({delay}ms)",
  "自动重试失败：{message}": "Auto retry failed: {message}",
  "扩展通知：{message}": "Extension notice: {message}",
  "pi 输出记录过大": "pi output record too large",
  "中止超时，强制终止": "Abort timed out; forcing termination",
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
  "继续等待": "Keep waiting",
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

