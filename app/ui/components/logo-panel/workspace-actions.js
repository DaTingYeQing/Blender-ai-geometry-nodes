/* ===== 组件：工作区底栏 =====
 * 文件夹 / 添加 / 删除 / 取消 / 确定。能不能点由区域按状态算好
 * （canOpenFolder/canAdd/canRemove/canConfirm）。
 * “打开文件夹”是宿主能力，不归状态管：由组装根通过区域注入 ctx.openFolder。
 */

import { EVENTS } from '../../contracts/events.js';
import { createDom } from '../dom.js';
import { createIcon } from '../icons.js';

/* 文件夹图标用 SVG 命名空间节点；测试里的假 DOM 没有 createElementNS 时退化为无图标按钮。 */
function createFolderIcon(doc) {
  if (typeof doc?.createElementNS !== 'function') return null;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(NS, 'svg');
  for (const [name, value] of Object.entries({
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  })) {
    svg.setAttribute(name, value);
  }
  const path = doc.createElementNS(NS, 'path');
  path.setAttribute('d', 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z');
  svg.appendChild(path);
  return svg;
}

export function createWorkspaceActions({ document }) {
  const { el } = createDom(document);

  return function workspaceActions(initialProps, ctx) {
    let props = initialProps;
    const panelId = props.panelId || 'logoPanel';

    const labels = () => props.labels || {};

    const folder = el('button', {
      className: 'folder-btn',
      attrs: { type: 'button' },
      on: {
        click: () => {
          if (folder.disabled) return;
          ctx.openFolder?.();
        },
      },
    });
    const folderIcon = createFolderIcon(document);
    if (folderIcon) folder.appendChild(folderIcon);
    const add = el('button', {
      className: 'plus-btn',
      text: '＋',
      attrs: { type: 'button' },
      on: {
        click: () => {
          if (add.disabled) return;
          ctx.emit({ type: EVENTS.WORKSPACE_ADD_CLICKED, payload: {} });
        },
      },
    });
    const remove = el('button', {
      className: 'trash-btn',
      attrs: { type: 'button' },
      on: {
        click: () => {
          if (remove.disabled) return;
          ctx.emit({ type: EVENTS.WORKSPACE_REMOVE_CLICKED, payload: {} });
        },
      },
    });
    remove.appendChild(createIcon(document, 'trash'));
    const spacer = el('span', { className: 'ws-spacer' });
    const cancel = el('button', {
      className: 'dlg-btn',
      attrs: { type: 'button' },
      on: {
        click: () => {
          if (cancel.disabled) return;
          ctx.emit({ type: EVENTS.PANEL_CLOSE_CLICKED, payload: { id: panelId } });
        },
      },
    });
    const confirm = el('button', {
      className: 'dlg-btn primary',
      attrs: { type: 'button' },
      on: {
        click: () => {
          if (confirm.disabled) return;
          ctx.emit({ type: EVENTS.WORKSPACE_ENTER_CLICKED, payload: {} });
        },
      },
    });

    const root = el('div', { className: 'dlg-actions ws-actions' }, [
      folder, add, remove, spacer, cancel, confirm,
    ]);

    function render() {
      const text = labels();
      folder.hidden = props.canOpenFolder !== true;
      folder.disabled = props.canOpenFolder !== true;
      add.hidden = props.canAdd === false;
      remove.hidden = props.canRemove === false;
      add.disabled = props.busy === true || props.canAdd === false;
      remove.disabled = props.busy === true || props.canRemove === false;
      cancel.textContent = text.cancel || '';
      cancel.disabled = props.busy === true;
      confirm.textContent = text.confirm || '';
      confirm.disabled = props.canConfirm !== true;

      for (const [button, label] of [[folder, text.folder], [add, text.add], [remove, text.remove]]) {
        if (!label) continue;
        button.setAttribute('title', label);
        button.setAttribute('aria-label', label);
      }
    }

    render();

    return {
      el: root,
      update(next) {
        props = next;
        render();
      },
      destroy() {
        root.remove?.();
      },
    };
  };
}
