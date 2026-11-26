/* ===== 组装根：更新入口 =====
 * 状态机和宿主调用都在这里；区域只负责画。
 *
 * 宿主桥：桌面版走 window.piFlow（主进程暂以开发用模拟数据响应，真实下载后续接入）。
 * 浏览器里没有宿主，自动退化成本地模拟，方便单独调 UI。
 */

import { createUpdatePanelRegion } from '../ui/regions/update-panel.js';

function createMockBridge() {
  const listeners = new Set();
  let timer = null;

  const components = [
    { id: 'app', current: '2.1.0', latest: '2.1.1', bytes: 38_000_000, changed: true },
    { id: 'blender', current: '2026-11-22', latest: '2026-12-01', bytes: 720_000_000, changed: true },
    { id: 'covtrace', current: '1.0.0', latest: '1.0.0', bytes: 32_000_000, changed: false },
  ];
  const totalBytes = components
    .filter((item) => item.changed)
    .reduce((sum, item) => sum + item.bytes, 0);

  function emit(event) {
    for (const handler of [...listeners]) {
      try {
        handler(event);
      } catch {
        // 单个监听器坏了不影响其他监听器。
      }
    }
  }

  function clearTimer() {
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    getVersion: async () => '2.1.0',
    checkUpdate: async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return {
        status: 'available',
        current: '2.1.0',
        latest: '2.1.1',
        components,
        totalBytes,
      };
    },
    startUpdate: async () => {
      clearTimer();
      const steps = 40;
      let step = 0;
      timer = setInterval(() => {
        step += 1;
        const ratio = Math.min(1, step / steps);
        const received = Math.round(totalBytes * ratio);
        let accumulated = 0;
        let component = 'app';
        for (const item of components.filter((entry) => entry.changed)) {
          accumulated += item.bytes;
          if (received <= accumulated) {
            component = item.id;
            break;
          }
        }
        emit({
          phase: 'progress',
          percent: Math.round(ratio * 100),
          received,
          total: totalBytes,
          component,
          speed: Math.round(totalBytes / (steps * 0.12)),
        });
        if (ratio >= 1) {
          clearTimer();
          emit({ phase: 'ready' });
        }
      }, 120);
      return { ok: true };
    },
    cancelUpdate: async () => {
      clearTimer();
      emit({ phase: 'cancelled' });
      return { ok: true };
    },
    restartApp: async () => ({ ok: true, mock: true }),
    onUpdateEvent: (handler) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    dispose: clearTimer,
  };
}

function normalizeResult(result) {
  const components = Array.isArray(result?.components) ? result.components : [];
  const total = Number(result?.totalBytes)
    || components
      .filter((item) => item?.changed)
      .reduce((sum, item) => sum + (Number(item?.bytes) || 0), 0);
  return {
    current: String(result?.current || ''),
    latest: String(result?.latest || ''),
    components,
    totalBytes: total,
  };
}

/**
 * @param {{
 *   document?: Document,
 *   translate?: (text: string, vars?: Record<string, unknown>) => string,
 *   notify?: (message: string, tone?: string) => void,
 * }} options
 */
export function mountUpdatePilot({
  document: doc = globalThis.document,
  translate = (text) => text,
  notify = () => {},
} = {}) {
  const overlay = doc?.getElementById?.('updatePanel');
  const container = overlay?.querySelector?.('.modal-update');
  const chip = doc?.getElementById?.('updateChip');
  if (!overlay || !container || !chip) {
    return { refresh() {}, destroy() {} };
  }

  const t = translate;
  const host = doc.defaultView?.piFlow;
  const bridge = host?.checkUpdate ? host : createMockBridge();
  const mock = bridge !== host;

  /** @type {any} */
  let view = { phase: 'idle', version: '' };
  let data = null;

  const region = createUpdatePanelRegion({
    document: doc,
    container,
    overlay,
    chip,
    translate: t,
    handlers: {
      onCheck: () => void check(),
      onStart: () => void start(),
      onCancel: () => void cancel(),
      onRestart: () => void restart(),
      onClose: () => {},
    },
  });

  const unsubscribe = bridge.onUpdateEvent?.((event) => {
    if (!event?.phase) return;
    if (event.phase === 'progress') {
      view = { ...view, phase: 'downloading', progress: event };
      region.update(view);
      return;
    }
    if (event.phase === 'ready') {
      view = {
        ...view,
        phase: 'ready',
        progress: { ...(view.progress || {}), percent: 100 },
      };
      region.update(view);
      return;
    }
    if (event.phase === 'error') {
      view = { ...view, phase: 'error', message: String(event.message || '') };
      region.update(view);
      return;
    }
    if (event.phase === 'cancelled') {
      view = { ...view, phase: 'available', progress: null };
      region.update(view);
    }
  });

  async function init() {
    try {
      const version = await bridge.getVersion?.();
      if (version) view = { ...view, version: String(version) };
    } catch {
      // 拿不到版本就不显示版本号，不影响更新。
    }
    region.update(view);
  }

  async function check() {
    if (view.phase === 'checking' || view.phase === 'downloading') return;
    view = { ...view, phase: 'checking', progress: null };
    region.update(view);
    try {
      const result = await bridge.checkUpdate();
      if (result?.status === 'available') {
        data = normalizeResult(result);
        view = { ...view, ...data, phase: 'available' };
        region.update(view);
        region.open();
        return;
      }
      if (result?.status === 'none') {
        view = { ...view, phase: 'idle' };
        region.update(view);
        notify(t('已是最新版本'), 'info');
        return;
      }
      throw new Error(result?.message || t('检查更新失败'));
    } catch (error) {
      view = { ...view, phase: 'idle' };
      region.update(view);
      notify(t('检查更新失败：{message}', { message: String(error?.message || error) }), 'error');
    }
  }

  async function start() {
    if (view.phase === 'downloading') return;
    view = { ...view, phase: 'downloading', progress: { percent: 0 }, message: '' };
    region.update(view);
    try {
      const result = await bridge.startUpdate();
      if (result?.ok === false) {
        throw new Error(result.message || t('下载失败'));
      }
    } catch (error) {
      view = { ...view, phase: 'error', message: String(error?.message || error) };
      region.update(view);
      region.open();
    }
  }

  async function cancel() {
    try {
      await bridge.cancelUpdate?.();
    } catch {
      // 取消失败也按已取消处理，界面不卡在下载态。
    }
    view = { ...view, phase: 'available', progress: null };
    region.update(view);
  }

  async function restart() {
    try {
      const result = await bridge.restartApp?.();
      if (result?.ok === false) {
        throw new Error(result.message || t('更新失败'));
      }
      if (result?.mock) notify(t('演示模式：这里会重启应用'), 'info');
    } catch (error) {
      notify(String(error?.message || error), 'error');
    }
  }

  void init();

  return {
    refresh() {
      region.update(view);
    },
    destroy() {
      unsubscribe?.();
      if (mock) bridge.dispose?.();
      region.destroy();
    },
  };
}
