/* ===== UI 端口契约（Ports）=====
 * 只有形状，没有实现。UI 里的 Effects 只认这里声明的能力，
 * 具体 HTTP/localStorage 由 adapters/ 实现，由 composition/ 注入。
 *
 * 三条纪律：
 *   1. 方法名对齐后端契约（server/contract.mjs），语义不变。
 *   2. 参数沿用现有调用形状（对象参数），不在这里做业务判断。
 *   3. 只有组装根知道这些接口由谁实现；其余文件只 import 本文件的类型。
 *
 * 只读方法都接受可选的 `signal`：Effects 在换屏 / 销毁时中止在途请求；
 * 写方法不传 signal（已经提交的写操作不该被半路取消）。
 *
 * 类型仅存在于 JSDoc 中，运行时不产生任何代码。
 */

/**
 * 语言偏好。zh / en。
 * @typedef {'zh' | 'en'} Locale
 */

/**
 * 单个 Agent（UI 里叫"团队"）。
 * @typedef {Object} AgentSummary
 * @property {string} id
 * @property {string} name
 * @property {Array<Object>} [sessions]
 */

/**
 * Agent 与会话领域。
 *
 * 会话 id 有两套：内部 id（session.id）与 pi 的会话 id（piSessionId）。
 * - getSession 两种都认，调用方目前传 pi 的会话 id。
 * - renameSession / deleteSession 传内部 id。
 *
 * @typedef {Object} AgentApi
 * @property {(args?: { signal?: AbortSignal }) => Promise<AgentSummary[]>} listAgents
 * @property {(args?: { signal?: AbortSignal }) => Promise<{ tools: string[], profiles: Object<string, Object> }>} getTools
 * @property {(body: { name: string, tools: string[] }) => Promise<AgentSummary>} createAgent
 * @property {(args: { agentId: string, signal?: AbortSignal }) => Promise<{ agent: Object, config: Object }>} getAgentConfig
 * @property {(args: { agentId: string, name: string, tools: string[] }) => Promise<Object>} saveAgentConfig
 * @property {(args: { id: string }) => Promise<Object>} deleteAgent
 * @property {(args: { agentId: string, sessionId: string, signal?: AbortSignal }) => Promise<{ entries: Array<Object>, missing?: boolean }>} getSession
 * @property {(args: { agentId: string, sessionId: string, title: string }) => Promise<Object>} renameSession
 * @property {(args: { agentId: string, sessionId: string }) => Promise<Object>} deleteSession
 */

/**
 * 流程（UI 里叫"工作区"）领域。
 * 后端只有整份保存：saveFlow 提交完整的 nodes + edges。
 *
 * @typedef {Object} FlowApi
 * @property {(args?: { signal?: AbortSignal }) => Promise<Array<{ id: string, name: string }>>} listFlows
 * @property {(body?: { name?: string }) => Promise<{ id: string, name: string }>} createFlow
 * @property {(args: { id: string, signal?: AbortSignal }) => Promise<Object>} getFlow
 * @property {(args: { id: string, name?: string, nodes: Array<Object>, edges: Array<Object> }) => Promise<Object>} saveFlow
 * @property {(args: { id: string }) => Promise<Object>} deleteFlow
 * @property {(args: { agentId: string }) => Promise<Object>} pruneFlows
 */

/**
 * 运行领域。后端没有推送，目前由业务层轮询 getRun。
 *
 * @typedef {Object} RunApi
 * @property {(body: { flowId: string, node: Object, inputFiles?: Array<{ name: string, path: string }> }) => Promise<Object>} runNode
 * @property {(args: { id: string, signal?: AbortSignal }) => Promise<Object>} getRun
 * @property {(args: { id: string }) => Promise<Object>} abortRun
 */

/**
 * 产物领域。只读。
 *
 * @typedef {Object} ArtifactApi
 * @property {(args: { path: string, signal?: AbortSignal }) => Promise<{ content?: string }>} readFile
 * @property {(args: { agentId: string, signal?: AbortSignal }) => Promise<Array<{ name: string, path: string, size: number, ext: string }>>} listFiles
 */

/**
 * 设置偏好。不是 HTTP API，由 local adapter 实现（localStorage）。
 *
 * @typedef {Object} SettingsApi
 * @property {() => Locale} getLocale
 * @property {(args: { lang: Locale }) => Promise<{ ok: boolean }>} setLang
 */

/**
 * 单人模式：启动外部 Pi 终端。
 * "团队 / 单人"的分支属于用例逻辑，放在 Effects；这里只有"启动"这一个动作。
 *
 * @typedef {Object} SingleApi
 * @property {() => Promise<Object>} launch
 */

/**
 * 动画。UI 只说“等这个元素的这次过渡结束”，不关心 CSS / WAAPI 的细节。
 * 由 adapters/animation/* 实现，组装时注入；测试可换成瞬时实现。
 *
 * @typedef {Object} AnimationPort
 * @property {(element: Element | null, options?: { animationName?: string, timeoutMs?: number }) => Promise<void>} waitUntilDone
 * @property {(element: Element | null, keyframes: Keyframe[], options?: KeyframeAnimationOptions) => Promise<void>} animate
 * @property {() => boolean} prefersReducedMotion
 */

/**
 * 组装根注入给 UI 的全部外部能力。
 * 动画不在这里：它由组装根单独创建后按区域注入（见 composition/boot.js）。
 *
 * @typedef {Object} UiPorts
 * @property {AgentApi} agentApi
 * @property {FlowApi} flowApi
 * @property {RunApi} runApi
 * @property {ArtifactApi} artifactApi
 * @property {SettingsApi} settingsApi
 * @property {SingleApi} singleApi
 */

export {};
