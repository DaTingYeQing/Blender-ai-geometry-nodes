/* ===== 效果：产物预览 =====
 * artifact.read → ArtifactReadModel.readFile → artifact.opened / artifact.open.failed。
 * 只按扩展名判断能不能当文本预览；图片 / 压缩包 / 二进制一律不读，避免满屏乱码。
 * 正文留在 ReadModel 的缓存里，事件只带 path 与 previewable，不把内容搬进状态。
 */

import { EVENTS, EVENT_KINDS, COMMANDS } from '../contracts/events.js';

/* 能按文本读的扩展名。没有扩展名的按文本试一次。 */
const TEXT_EXT = new Set([
  'md', 'markdown', 'txt', 'log', 'json', 'jsonl', 'csv', 'tsv',
  'yaml', 'yml', 'xml', 'html', 'htm', 'css', 'svg',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'py', 'sh', 'ps1', 'bat', 'cmd',
  'ini', 'toml', 'cfg', 'conf', 'env',
  'glsl', 'frag', 'vert',
]);

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isPreviewable(name) {
  const match = /\.([a-zA-Z0-9]+)$/.exec(String(name || ''));
  if (!match) return true;
  return TEXT_EXT.has(match[1].toLowerCase());
}

function messageOf(error) {
  return String(error?.message || error || '');
}

/**
 * @param {{
 *   readModel: ReturnType<typeof import('./artifact-read-model.js').createArtifactReadModel>,
 *   emit: (event: import('../contracts/events.js').UiEvent) => void,
 * }} deps
 */
export function createArtifactEffects({ readModel, emit }) {
  if (typeof emit !== 'function') throw new Error('createArtifactEffects: 需要注入 emit(event)');
  if (typeof readModel?.readFile !== 'function') {
    throw new Error('createArtifactEffects: 需要 ArtifactReadModel');
  }

  function result(type, requestId, payload) {
    emit({ type, kind: EVENT_KINDS[type] || 'mutate', requestId, payload });
  }

  async function readArtifact({ requestId, path, name }) {
    if (!path) {
      result(EVENTS.ARTIFACT_OPEN_FAILED, requestId, { path: '', error: '缺少文件路径' });
      return;
    }

    if (!isPreviewable(name || path)) {
      /* 面板照常打开，只是不读正文；这是旧查看器的行为。 */
      result(EVENTS.ARTIFACT_OPENED, requestId, { path, previewable: false });
      return;
    }

    try {
      await readModel.readFile(path);
      result(EVENTS.ARTIFACT_OPENED, requestId, { path, previewable: true });
    } catch (error) {
      result(EVENTS.ARTIFACT_OPEN_FAILED, requestId, {
        path,
        error: messageOf(error),
      });
    }
  }

  return {
    /**
     * @param {import('../contracts/events.js').UiCommand} command
     * @returns {Promise<boolean>} 是否处理了这条命令
     */
    async execute(command) {
      if (command?.type !== COMMANDS.ARTIFACT_READ) return false;
      await readArtifact(command.payload || {});
      return true;
    },
  };
}
