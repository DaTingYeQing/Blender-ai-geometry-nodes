/* ===== UI State 契约 =====
 * 只有类型，没有实现。对应 state.md 的 8.2 / 8.3。
 *
 * 两条硬约束（架构测试会扫）：
 *   1. 可序列化：不放 DOM、函数、Promise、Set、类实例。
 *   2. 不镜像后端：Agent 列表、工具目录这类业务数据属于 ReadModel，
 *      由 Effects 维护；这里只放 View 需要的事实（草稿、开关、请求状态）。
 */

/**
 * @typedef {'idle' | 'loading' | 'success' | 'error'} RequestStatus
 */

/**
 * @typedef {Object} RequestState
 * @property {RequestStatus} status
 * @property {string} [error]
 * @property {number} [requestId]
 */

/**
 * @typedef {'new' | 'existing'} AgentTab
 */

/**
 * 新建 agent 的草稿。tools 用数组而不是 Set，保证可序列化。
 * @typedef {Object} AgentNewDraft
 * @property {string} name
 * @property {string[]} tools
 */

/**
 * 配置现有 agent 的草稿。
 * @typedef {Object} AgentExistingDraft
 * @property {string | null} agentId
 * @property {string} name
 * @property {string[]} tools
 * @property {string | null} loadedFor  已经拉过配置的 agentId，避免重复请求
 * @property {boolean} dirty            用户改过表单后，晚到的配置不得覆盖
 */

/**
 * @typedef {Object} UiDrafts
 * @property {AgentNewDraft} agentNew
 * @property {AgentExistingDraft} agentExisting
 */

/**
 * 当前屏幕。Phase 1 由 workspace.entered / settings.mode 派生；
 * 设置面板是模态，不是独立屏幕。
 * @typedef {'single' | 'team' | 'workspace'} RouteName
 */

/**
 * 当前屏幕。params 只放切屏必需的事实，不放业务数据。
 * @typedef {Object} Route
 * @property {RouteName} name
 * @property {Record<string, string>} params
 */

/**
 * @typedef {'starting' | 'ready' | 'runtime_missing' | 'backend_not_ready' | 'offline' | 'session_lost'} AppStatus
 */

/**
 * 应用能不能用：先判断这个，再判断某个区域能不能用。
 * @typedef {Object} AppGate
 * @property {AppStatus} status
 * @property {string} [detail] 给用户看的简短原因（不是堆栈）
 */

/**
 * 全局提示（toast）。字段级错误仍留在 requests 里，这里只放“需要打断用户”的。
 * @typedef {'info' | 'success' | 'error'} NoticeTone
 */

/**
 * @typedef {Object} Notice
 * @property {string} id
 * @property {NoticeTone} tone
 * @property {string} message
 */

/**
 * 已进入的工作区。solo 模式不进团队画布（entered 保持 null），
 * 只记在 requests.enter 的成功里，对应旧业务“启动终端后 entered=false”。
 * @typedef {Object} WorkspaceEntry
 * @property {'team'} mode
 * @property {string | null} workspaceId
 */

/**
 * 设置面板的工作区切片：选中哪个方框、是否已进入、三条请求的在飞状态。
 * 工作区列表本体属于 FlowReadModel，不在这里镜像。
 * @typedef {Object} WorkspaceState
 * @property {string | null} selectedId
 * @property {WorkspaceEntry | null} entered
 * @property {{ enter: RequestState, add: RequestState, remove: RequestState, rename: RequestState }} requests
 */

/**
 * 侧栏展开的入口：哪个团队、哪个节点 / 连线、停在哪一屏。
 * 只记“打开了什么”，不等于 focusPath（谁能改）。
 * @typedef {Object} SidebarFocus
 * @property {string | null} teamId
 * @property {string | null} nodeId
 * @property {string | null} edgeId
 * @property {'default' | 'products' | 'result'} pane
 */

/**
 * 侧栏切片：目前只持有展开态。团队 / 节点 / 会话数据属于 ReadModel，不在这里镜像。
 * @typedef {Object} SidebarState
 * @property {SidebarFocus} focus
 */

/**
 * 团队切片：只记删除请求的在飞状态。团队列表属于 TeamReadModel，
 * 节点 / 连线在 canvas 切片，结果由组装根控制器写回。
 * @typedef {Object} TeamState
 * @property {{ remove: RequestState }} requests
 */

/**
 * 正在看的会话（结果屏下拉选中的那一段）。正文不在这里镜像：
 * 正文由 SessionReadModel 缓存，本切片只记视图与在飞请求。
 * @typedef {Object} SessionView
 * @property {string | null} agentId
 * @property {string | null} sessionId
 */

/**
 * 会话切片：读取 / 改名 / 删除三条请求的在飞状态。
 * 团队列表与对话正文属于 ReadModel，不在这里镜像。
 * @typedef {Object} SessionState
 * @property {SessionView} view
 * @property {{ load: RequestState, rename: RequestState, remove: RequestState }} requests
 */

/**
 * 画布切片：当前流程的节点 / 连线事实来源（含运行态字段）。
 * 团队列表属于 TeamReadModel；颜色在组装根投影快照时补。
 * @typedef {Object} CanvasState
 * @property {Array<Object>} nodes 节点（agentId / x / y / task / 会话 / 运行态）
 * @property {Array<Object>} edges 连线（from / to / bow / files）
 * @property {boolean} loaded     是否装上过一份流程（空流程也算已装载）
 */

/**
 * 手动保存器的状态。作者是组装根注入的 saver，经 workspace.save.state.changed 镜像。
 * @typedef {'idle' | 'dirty' | 'saving' | 'saved' | 'failed'} SaveStatus
 */

/**
 * 右侧产物查看器。正文不在这里镜像：读到后由 ArtifactReadModel 缓存，区域按 path 取。
 * @typedef {Object} ArtifactState
 * @property {boolean} open
 * @property {string} name
 * @property {string} path
 * @property {string} color        产出节点的颜色（CSS 值），空串表示沿用边框色
 * @property {boolean} previewable 扩展名是否允许按文本预览
 * @property {RequestStatus} status
 * @property {string} error
 */

/**
 * UI 状态只保存界面事实，必须可序列化。
 *
 * requests 的 key 是请求名（tools / agentConfig / agentCreate / agentSave），
 * 用 requestId 丢弃过期响应。
 *
 * @typedef {Object} UiState
 * @property {Route} route
 * @property {AppGate} app
 * @property {Notice[]} notices
 * @property {number} noticeSeq
 * @property {Record<string, boolean>} panels
 * @property {Record<string, string>} panelTabs
 * @property {Record<string, TransitionPhase>} transitions  需要等待的过渡（打开 / 关闭）
 * @property {string} nav
 * @property {string[]} focusPath
 * @property {SidebarState} sidebar
 * @property {TeamState} team
 * @property {SessionState} session
 * @property {CanvasState} canvas
 * @property {{ lang: 'zh' | 'en', mode: 'team' | 'solo' }} settings
 * @property {{ status: SaveStatus }} save
 * @property {ArtifactState} artifact
 * @property {WorkspaceState} workspace
 * @property {Record<string, RequestState>} requests
 * @property {UiDrafts} drafts
 */

/**
 * 过渡阶段。opening 等入场动画播完；closing 等退场动画播完再隐藏。
 * 两者都由 Animator 的 anim.done 收尾，reducer 按 payload.phase 区分。
 * @typedef {'idle' | 'opening' | 'closing'} TransitionPhase
 */

/**
 * @typedef {Object} UiTransition
 * @property {UiState} state
 * @property {import('./events.js').UiCommand[]} [commands]
 */

export {};
