/* ===== UI 状态持久化契约（纯函数）=====
 * common.md / state.md：只持久化“下次启动还需要”的少量字段。
 * 这里只做“状态 ↔ 可落盘对象”的编解码与校验；存储读写由组装根注入，
 * 防抖计时在 adapters/local/persistence.js（state 层必须保持纯函数）。
 *
 * 规则：
 *   1. 只写 PERSISTED_FIELDS 里的字段；focusPath / requests / transitions / notices /
 *      drafts / 临时错误 / 画布 live 坐标一律不落盘。
 *   2. 版本号必需：不认识的版本（含损坏数据）整体回退默认值，不猜、不迁移一半。
 *   3. 迁移表目前为空；以后加版本时在 MIGRATIONS 里补一条链式转换。
 */

export const PERSIST_KEY = 'flow.ui';
export const PERSIST_VERSION = 1;

/** 允许落盘的顶层字段。 */
export const PERSISTED_FIELDS = Object.freeze(['settings']);

/** 版本迁移表：version → (data) => data（目前没有历史版本）。 */
export const MIGRATIONS = Object.freeze({});

function normalizeLang(value) {
  return value === 'en' ? 'en' : value === 'zh' ? 'zh' : null;
}

/* 模式只记团队 / 单人；缺失或非法一律按 team 处理（老数据没有这个字段）。 */
function normalizeMode(value) {
  return value === 'solo' ? 'solo' : 'team';
}

/**
 * 把状态裁成可持久化的最小对象。
 * @param {import('../contracts/state.js').UiState} state
 */
export function toPersisted(state) {
  return {
    version: PERSIST_VERSION,
    settings: {
      lang: normalizeLang(state?.settings?.lang) ?? 'zh',
      mode: normalizeMode(state?.settings?.mode),
    },
  };
}

/**
 * 链式迁移到当前版本；版本不认识或链条断了返回 null。
 * @param {any} raw
 */
export function migrate(raw) {
  let data = raw;
  while (data && typeof data === 'object' && data.version < PERSIST_VERSION) {
    const step = MIGRATIONS[data.version];
    if (typeof step !== 'function') return null;
    data = step(data);
  }
  if (!data || typeof data !== 'object' || data.version !== PERSIST_VERSION) return null;
  return data;
}

/**
 * 校验并还原成状态补丁（settings.lang / settings.mode）；非法数据返回 null。
 * mode 缺失按 team（老版本数据只有 lang）。
 * @param {any} raw
 * @returns {{ settings: { lang: 'zh' | 'en', mode: 'team' | 'solo' } } | null}
 */
export function fromPersisted(raw) {
  const data = migrate(raw);
  if (!data) return null;
  const lang = normalizeLang(data.settings?.lang);
  if (!lang) return null;
  return { settings: { lang, mode: normalizeMode(data.settings?.mode) } };
}

/**
 * 读取：任何异常都当作“没有存过”，不阻塞首屏。
 * @param {{ getItem?: (key: string) => string | null } | null | undefined} storage
 */
export function readPersisted(storage) {
  try {
    const text = storage?.getItem?.(PERSIST_KEY);
    if (!text) return null;
    return fromPersisted(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * 写入：隐私模式 / 配额满了只返回 false，不抛错、不打扰界面。
 * @param {{ setItem?: (key: string, value: string) => void } | null | undefined} storage
 * @param {import('../contracts/state.js').UiState} state
 */
export function writePersisted(storage, state) {
  try {
    storage?.setItem?.(PERSIST_KEY, JSON.stringify(toPersisted(state)));
    return true;
  } catch {
    return false;
  }
}

