/* ===== 组装：把具体 Adapter 接成 UI 认识的 Ports =====
 * 这是唯一 import 具体 Adapter 的地方。UI、Effects、适配层互不相识。
 *
 * 传输层需要当前语言来带 X-Pi-Locale 请求头，所以先造 settings，
 * 再用它的 getLocale 作为 transport 的依赖 —— 顺序不能反。
 */

import { createTransport } from '../adapters/http/transport.js';
import { createAgentAdapter } from '../adapters/http/agent.js';
import { createFlowAdapter } from '../adapters/http/flow.js';
import { createRunAdapter } from '../adapters/http/run.js';
import { createArtifactAdapter } from '../adapters/http/artifact.js';
import { createSingleAdapter } from '../adapters/http/single.js';
import { createSettingsAdapter } from '../adapters/local/settings.js';

/* 后端默认 15s 超时：避免启动门或某个面板的 loading 永远停住。
 * 测试/特殊宿主可以通过 options.timeoutMs 覆盖。 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

/**
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   baseUrl?: string,
 *   timeoutMs?: number,
 *   storage?: Storage,
 * }} [options]
 * @returns {import('../ui/contracts/ports.js').UiPorts}
 */
export function createApiPorts(options = {}) {
  const settingsApi = createSettingsAdapter({ storage: options.storage });
  const { request } = createTransport({
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl,
    timeoutMs: Number.isFinite(options.timeoutMs)
      ? options.timeoutMs
      : DEFAULT_REQUEST_TIMEOUT_MS,
    getLocale: () => settingsApi.getLocale(),
  });

  return {
    settingsApi,
    agentApi: createAgentAdapter({ request }),
    flowApi: createFlowAdapter({ request }),
    runApi: createRunAdapter({ request }),
    artifactApi: createArtifactAdapter({ request }),
    singleApi: createSingleAdapter({ request }),
  };
}
