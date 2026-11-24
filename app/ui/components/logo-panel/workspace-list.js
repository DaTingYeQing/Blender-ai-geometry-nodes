/* ===== 组件：工作区方框列表 =====
 * 列表内容由区域从 FlowReadModel 取；这里只画名字、选中态、上报点击与改名。
 * 改名是视图本地编辑态：回车/失焦提交，Esc 取消；提交后由状态层发命令。
 */

import { EVENTS } from '../../contracts/events.js';
import { createDom } from '../dom.js';

export function createWorkspaceList({ document }) {
  const { el, clear } = createDom(document);

  return function workspaceList(initialProps, ctx) {
    let props = initialProps;
    let editingId = null;
    let editValue = '';
    const root = el('div', { className: 'team-box' });

    function select(item) {
      if (props.disabled) return;
      ctx.emit({ type: EVENTS.WORKSPACE_SELECT_CLICKED, payload: { workspaceId: item.id } });
    }

    function startEdit(item) {
      if (props.disabled) return;
      editingId = item.id;
      editValue = item.name;
      render();
    }

    function commit(item) {
      const name = editValue.trim();
      editingId = null;
      render();
      if (!name || name === item.name) return;
      ctx.emit({
        type: EVENTS.WORKSPACE_RENAME_SUBMITTED,
        payload: { workspaceId: item.id, name },
      });
    }

    function cancel() {
      editingId = null;
      render();
    }

    function renderItem(item) {
      const selected = item.id === props.selectedId;
      const node = el('div', {
        className: `box-item${selected ? ' selected' : ''}`,
        dataset: { wsId: item.id },
        attrs: {
          role: 'option',
          tabindex: '0',
          'aria-selected': selected ? 'true' : 'false',
        },
        on: {
          click: () => select(item),
          keydown: (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            select(item);
          },
        },
      });

      if (editingId === item.id) {
        const input = el('input', {
          className: 'box-input',
          attrs: { type: 'text', maxlength: '40' },
          on: {
            input: (event) => { editValue = event.target.value; },
            keydown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commit(item);
              } else if (event.key === 'Escape') {
                cancel();
              }
            },
            blur: () => commit(item),
          },
        });
        input.value = editValue;
        node.appendChild(input);
        return { node, focus: input };
      }

      node.appendChild(el('span', { className: 'box-name', text: item.name }));
      node.appendChild(el('button', {
        className: 'box-edit',
        text: '✎',
        attrs: {
          type: 'button',
          title: props.editLabel || '',
          'aria-label': props.editLabel || '',
        },
        on: {
          click: (event) => {
            event.stopPropagation?.();
            startEdit(item);
          },
        },
      }));
      return { node, focus: null };
    }

    function render() {
      root.hidden = props.visible === false;
      clear(root);

      const items = props.items || [];
      if (!items.length) {
        root.appendChild(el('p', { className: 'ws-empty', text: props.emptyText || '' }));
        return;
      }

      let focusTarget = null;
      for (const item of items) {
        const { node, focus } = renderItem(item);
        root.appendChild(node);
        if (focus) focusTarget = focus;
      }
      focusTarget?.focus?.();
      focusTarget?.select?.();
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
