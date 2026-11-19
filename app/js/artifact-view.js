/* ===== UI：产物查看器（右侧栏）=====
 * 点侧栏产物列表里的文件，右侧滑出一块面板显示内容。
 * 面板宽度可拖，最大不会压到左侧栏；边框颜色跟随产出这个文件的节点。
 * 数据只从 api.readFile 来，渲染只交给 shared/markdown.mjs。
 */

import { api } from '../src/host/api.js';
import { renderMarkdown } from '../../shared/markdown.mjs';
import { toast } from './core/dom.js';
import { t } from './core/i18n.js';

const MIN_WIDTH = 280;
const DEFAULT_WIDTH = 420;
const GAP = 240;            // 主区域至少留这么宽，右侧栏再大也不能把画布挤没

/* 能按文本读的扩展名。其余（图片、压缩包、模型、可执行文件）一律不预览，
 * 免得把二进制当 utf8 读出来满屏乱码。没有扩展名的按文本试一次。 */
const TEXT_EXT = new Set([
  'md', 'markdown', 'txt', 'log', 'json', 'jsonl', 'csv', 'tsv',
  'yaml', 'yml', 'xml', 'html', 'htm', 'css', 'svg',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'py', 'sh', 'ps1', 'bat', 'cmd',
  'ini', 'toml', 'cfg', 'conf', 'env',
  'glsl', 'frag', 'vert',
]);

function isPreviewable(name) {
  const match = /\.([a-zA-Z0-9]+)$/.exec(String(name || ''));
  if (!match) return true;          // 没有扩展名，当文本试试
  return TEXT_EXT.has(match[1].toLowerCase());
}

export function mountArtifactView() {
  const pane = document.getElementById('artifactPane');
  const splitter = document.getElementById('artifactSplitter');
  const nameEl = document.getElementById('artifactName');
  const content = document.getElementById('artifactContent');
  const closeBtn = document.getElementById('artifactClose');
  const sidebar = document.getElementById('sidebar');

  let width = DEFAULT_WIDTH;
  let dragging = false;
  let startX = 0;
  let startW = 0;

  /* 上限按"窗口宽 - 左侧栏 - 主区域保底"算，左侧栏拉宽时右侧栏也就跟着收。 */
  function limits() {
    const left = sidebar ? sidebar.getBoundingClientRect().width : 260;
    return {
      min: MIN_WIDTH,
      max: Math.max(MIN_WIDTH, Math.round(window.innerWidth - left - GAP)),
    };
  }

  function setWidth(px) {
    const { min, max } = limits();
    width = Math.max(min, Math.min(max, px));
    pane.style.width = width + 'px';
  }

  function close() {
    pane.hidden = true;
    splitter.hidden = true;
    content.replaceChildren();
    nameEl.textContent = '';
  }

  async function open(file, color) {
    pane.hidden = false;
    splitter.hidden = false;
    setWidth(width);
    pane.style.setProperty('--ap-team', color || 'var(--border)');
    nameEl.textContent = file.name;
    nameEl.title = file.name;
    content.textContent = t('加载中…');

    if (!isPreviewable(file.name)) {
      content.textContent = t('这个文件类型不支持预览');
      return;
    }

    try {
      const data = await api.readFile({ path: file.path });
      content.innerHTML = renderMarkdown(data.content || '');
      content.parentElement.scrollTop = 0;
    } catch (error) {
      const message = String(error?.message || error);
      content.textContent = message;
      toast(message);
    }
  }

  /* 点击产物条目：现有逻辑会把它选中传给下游，这里顺带打开查看。 */
  document.addEventListener('click', (event) => {
    const option = event.target.closest('.ti-pane-products .ti-option');
    if (!option) return;
    const path = option.dataset.path || '';
    if (!path) return;
    const card = option.closest('.team-item');
    const color = card ? card.style.getPropertyValue('--team') : '';
    open({ name: option.dataset.name || option.textContent, path }, color.trim());
  });

  closeBtn.addEventListener('click', close);

  splitter.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    dragging = true;
    startX = event.clientX;
    startW = pane.getBoundingClientRect().width;
    document.body.classList.add('ap-dragging');
    event.preventDefault();
  });

  window.addEventListener('mousemove', (event) => {
    if (!dragging) return;
    setWidth(startW - (event.clientX - startX));   // 往左拖 = 变宽
  });

  const stop = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('ap-dragging');
  };
  window.addEventListener('mouseup', stop);
  window.addEventListener('blur', stop);   // 失焦兜底，别让鼠标粘在分割条上
  window.addEventListener('resize', () => {
    if (!pane.hidden) setWidth(width);     // 窗口变小 / 左侧栏变宽时收回来
  });
}
