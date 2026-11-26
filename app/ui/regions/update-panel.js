/* ===== 区域：更新窗口 =====
 * 纯视图：状态由 composition/update.js 投影进来，这里只负责顶栏按钮和弹窗的
 * 渲染、显隐、焦点与点击回传。不拉取、不下载、不读宿主。
 *
 * view 形状：
 *   { phase, version, current, latest, components, totalBytes, progress, message }
 * phase: idle / checking / available / downloading / ready / error
 */

const COMPONENT_LABELS = {
  app: '程序',
  blender: 'Blender',
  covtrace: 'CovTrace',
};

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const digits = size >= 100 || index === 0 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[index]}`;
}

/**
 * @param {{
 *   document: Document,
 *   container: HTMLElement,
 *   overlay: HTMLElement,
 *   chip: HTMLElement,
 *   translate?: (text: string, vars?: Record<string, unknown>) => string,
 *   handlers?: {
 *     onCheck?: () => void,
 *     onStart?: () => void,
 *     onCancel?: () => void,
 *     onRestart?: () => void,
 *     onClose?: () => void,
 *   },
 * }} options
 */
export function createUpdatePanelRegion({
  document: doc,
  container,
  overlay,
  chip,
  translate = (text) => text,
  handlers = {},
}) {
  if (!doc) throw new Error('createUpdatePanelRegion: 需要 document');
  if (!container) throw new Error('createUpdatePanelRegion: 需要容器');
  if (!overlay) throw new Error('createUpdatePanelRegion: 需要遮罩');
  if (!chip) throw new Error('createUpdatePanelRegion: 需要顶栏按钮');

  const t = translate;
  const { onCheck, onStart, onCancel, onRestart, onClose } = handlers;

  const chipVersion = doc.getElementById('updateChipVersion');
  const chipDot = doc.getElementById('updateChipDot');

  let view = { phase: 'idle', version: '' };
  let opened = false;
  let primaryButton = null;

  /* ---------- DOM ---------- */

  function el(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function button(label, className, handler) {
    const node = el('button', `dlg-btn${className ? ` ${className}` : ''}`, label);
    node.setAttribute('type', 'button');
    node.addEventListener('click', handler);
    return node;
  }

  const closeButton = el('button', 'm-close', '✕');
  closeButton.setAttribute('type', 'button');
  closeButton.setAttribute('aria-label', t('关闭'));
  closeButton.addEventListener('click', () => close());

  const body = el('div', 'update-body');
  const actions = el('div', 'update-actions');
  container.replaceChildren(closeButton, body, actions);
  container.setAttribute('role', 'dialog');
  container.setAttribute('aria-modal', 'true');
  container.setAttribute('aria-labelledby', 'updateTitle');

  /* ---------- 显隐 ---------- */

  function focusPrimary() {
    primaryButton?.focus?.();
  }

  function open() {
    if (opened) return;
    opened = true;
    overlay.classList.add('open');
    chip.setAttribute('aria-expanded', 'true');
    renderBody();
    focusPrimary();
  }

  function close() {
    if (!opened) return;
    opened = false;
    overlay.classList.remove('open');
    chip.setAttribute('aria-expanded', 'false');
    onClose?.();
    chip.focus?.();
  }

  function isOpen() {
    return opened;
  }

  /* ---------- 顶栏按钮 ---------- */

  function componentLabel(id) {
    const key = COMPONENT_LABELS[id];
    return key ? t(key) : String(id || '');
  }

  function renderChip() {
    const phase = view.phase;
    const percent = Number(view.progress?.percent);
    const downloading = phase === 'downloading';

    let label = view.version ? `v${view.version}` : t('开发版');
    if (downloading && Number.isFinite(percent)) label = `${Math.round(percent)}%`;
    if (chipVersion) chipVersion.textContent = label;

    chip.classList.toggle('is-checking', phase === 'checking');
    chip.classList.toggle('is-downloading', downloading);
    chip.classList.toggle('is-ready', phase === 'ready');
    chip.classList.toggle('has-update', phase === 'available');
    chip.classList.toggle('has-error', phase === 'error');
    if (chipDot) {
      chipDot.hidden = !(
        phase === 'available' || downloading || phase === 'ready' || phase === 'error'
      );
    }

    chip.disabled = phase === 'checking';
    const title = phase === 'checking'
      ? t('正在检查更新…')
      : phase === 'available'
        ? t('有新版本可用')
        : t('检查更新');
    chip.setAttribute('title', title);
    chip.setAttribute('aria-label', title);
  }

  /* ---------- 弹窗内容 ---------- */

  function title(text) {
    const node = el('h2', 'update-title', text);
    node.id = 'updateTitle';
    return node;
  }

  function componentRows() {
    const list = el('div', 'update-list');
    for (const item of view.components || []) {
      const changed = Boolean(item?.changed);
      const row = el('div', `update-row${changed ? '' : ' is-unchanged'}`);

      const name = componentLabel(item?.id);
      row.appendChild(el('span', 'update-row-name', name));

      if (item?.current || item?.latest) {
        const version = changed && item.latest
          ? `${item.current || '?'} → ${item.latest}`
          : String(item.current || '');
        if (version) row.appendChild(el('span', 'update-row-version', version));
      }

      row.appendChild(el(
        'span',
        'update-row-size',
        changed ? formatBytes(item?.bytes) : t('已是最新，不会下载'),
      ));
      list.appendChild(row);
    }
    return list;
  }

  function renderAvailable() {
    body.replaceChildren(title(t('发现新版本')));

    if (view.current || view.latest) {
      body.appendChild(el(
        'p',
        'update-sub',
        `${view.current ? `v${view.current}` : '?'} → ${view.latest ? `v${view.latest}` : '?'}`,
      ));
    }

    const components = Array.isArray(view.components) ? view.components : [];
    if (components.length) {
      body.appendChild(el('p', 'update-section-title', t('需要下载')));
      body.appendChild(componentRows());
    }

    if (Number(view.totalBytes) > 0) {
      body.appendChild(el(
        'p',
        'update-total',
        t('总计：{size}', { size: formatBytes(view.totalBytes) }),
      ));
    }
    body.appendChild(el('p', 'update-note', t('用户数据、工作区和已有配置不会被删除。')));

    const start = button(t('立即更新'), 'primary', () => onStart?.());
    primaryButton = start;
    actions.replaceChildren(start, button(t('稍后'), '', () => close()));
  }

  function renderDownloading() {
    const progress = view.progress || {};
    const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
    const name = progress.component ? componentLabel(progress.component) : '';

    body.replaceChildren(title(t('正在下载')));
    const head = el('div', 'update-progress-head');
    head.appendChild(el('span', '', name ? t('正在下载 {name}', { name }) : t('正在下载')));
    head.appendChild(el('span', 'update-progress-percent', `${Math.round(percent)}%`));
    body.appendChild(head);

    const bar = el('div', 'update-bar');
    const fill = el('div', 'update-bar-fill');
    fill.style.width = `${percent}%`;
    bar.appendChild(fill);
    body.appendChild(bar);

    const meta = [];
    if (Number(progress.received) > 0 && Number(progress.total) > 0) {
      meta.push(`${formatBytes(progress.received)} / ${formatBytes(progress.total)}`);
    }
    if (Number(progress.speed) > 0) {
      meta.push(`${formatBytes(progress.speed)}/s`);
    }
    if (meta.length) body.appendChild(el('p', 'update-progress-meta', meta.join(' · ')));

    primaryButton = null;
    actions.replaceChildren(button(t('取消'), '', () => onCancel?.()));
  }

  function renderReady() {
    body.replaceChildren(title(t('准备重启')));
    body.appendChild(el('p', 'update-ready', t('更新已下载完成，重启后生效。')));
    body.appendChild(el('p', 'update-note', t('用户数据、工作区和已有配置不会被删除。')));

    const restart = button(t('重启并完成更新'), 'primary', () => onRestart?.());
    primaryButton = restart;
    actions.replaceChildren(restart, button(t('稍后'), '', () => close()));
  }

  function renderError() {
    body.replaceChildren(title(t('更新失败')));
    body.appendChild(el('p', 'update-error', view.message || t('下载失败')));
    body.appendChild(el('p', 'update-note', t('旧版本没有被修改。')));

    const retry = button(t('重试'), 'primary', () => onStart?.());
    primaryButton = retry;
    actions.replaceChildren(retry, button(t('关闭'), '', () => close()));
  }

  function renderBody() {
    primaryButton = null;
    switch (view.phase) {
      case 'available':
        renderAvailable();
        break;
      case 'downloading':
        renderDownloading();
        break;
      case 'ready':
        renderReady();
        break;
      case 'error':
        renderError();
        break;
      default:
        body.replaceChildren();
        actions.replaceChildren();
        break;
    }
  }

  /* ---------- 事件 ---------- */

  chip.addEventListener('click', () => {
    const phase = view.phase;
    if (phase === 'idle') {
      onCheck?.();
      return;
    }
    if (phase === 'checking') return;
    open();
  });

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  function onKeydown(event) {
    if (event.key !== 'Escape' || !opened) return;
    event.preventDefault?.();
    close();
  }
  doc.addEventListener('keydown', onKeydown);

  /* ---------- 对外 ---------- */

  function update(next) {
    view = next || { phase: 'idle', version: '' };
    closeButton.setAttribute('aria-label', t('关闭'));
    renderChip();
    if (opened) renderBody();
  }

  chip.setAttribute('aria-expanded', 'false');
  update(view);

  return {
    el: container,
    update,
    open,
    close,
    isOpen,
    destroy() {
      doc.removeEventListener('keydown', onKeydown);
      overlay.classList.remove('open');
      container.replaceChildren();
    },
  };
}
