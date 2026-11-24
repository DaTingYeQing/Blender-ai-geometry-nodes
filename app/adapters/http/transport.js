/* ===== HTTP 传输层（transport）=====
 * 唯一出现 fetch、URL、请求头、超时、错误归一化的地方。
 *
 * 领域 Adapter 只负责"拼路径 + 拆响应"，不重复判错：
 * 网络/HTTP/解析错误统一在下游变成 TransportError，带稳定的 code。
 *
 * 依赖注入 fetchImpl，是为了测试时能塞假实现，不需要起后端。
 */

/** 稳定错误形状。Effects 只看 code / status，不再解析原始异常。 */
export class TransportError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: 'http'|'network'|'timeout'|'aborted'|'parse', body?: unknown, cause?: unknown }} [info]
   */
  constructor(message, { status = 0, code = 'http', body = null, cause } = {}) {
    super(message);
    this.name = 'TransportError';
    this.status = status;
    this.code = code;
    this.body = body;
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   baseUrl?: string,
 *   getLocale?: () => string,
 *   timeoutMs?: number,
 * }} [options]
 * @returns {{ request: (path: string, init?: { method?: string, body?: unknown, headers?: Object<string,string>, signal?: AbortSignal }) => Promise<any> }}
 */
export function createTransport({
  fetchImpl,
  baseUrl = '',
  getLocale = () => 'en',
  timeoutMs = 0,
} = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new Error('createTransport: 需要一个 fetch 实现');
  }

  async function request(path, { method = 'GET', body, headers = {}, signal } = {}) {
    /* 已取消的请求不要再打出去：换屏 / 销毁时这是常见路径。 */
    if (signal?.aborted) {
      throw new TransportError('Request aborted', { code: 'aborted', cause: signal.reason });
    }

    const controller = timeoutMs > 0 ? new AbortController() : null;
    let timer = null;
    let effectiveSignal = signal;
    const onAbort = () => controller.abort(signal.reason);

    if (controller) {
      effectiveSignal = controller.signal;
      if (signal) {
        if (signal.aborted) controller.abort(signal.reason);
        else signal.addEventListener('abort', onAbort, { once: true });
      }
      timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    }

    let res;
    try {
      res = await doFetch(baseUrl + path, {
        method,
        headers: {
          'X-Pi-Locale': getLocale(),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: effectiveSignal,
      });
    } catch (cause) {
      /* 调用方主动取消与超时分开报：前者是正常换屏/销毁，后者才是“太慢”。 */
      if (signal?.aborted) {
        throw new TransportError('Request aborted', { code: 'aborted', cause });
      }
      if (controller?.signal.aborted) {
        throw new TransportError(`Request timed out after ${timeoutMs}ms`, { code: 'timeout', cause });
      }
      throw new TransportError('Network request failed', { code: 'network', cause });
    } finally {
      if (timer) clearTimeout(timer);
      if (signal && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort);
      }
    }

    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (cause) {
        throw new TransportError('Invalid JSON response', {
          status: res.status,
          code: 'parse',
          cause,
        });
      }
    }

    if (!res.ok) {
      throw new TransportError(
        data?.error || `Request failed (${res.status})`,
        { status: res.status, code: 'http', body: data },
      );
    }
    return data;
  }

  return { request };
}
