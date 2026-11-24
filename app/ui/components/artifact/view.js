/* ===== 组件：产物查看器 =====
 * 只画右侧面板内部（头部 + 正文），显隐 / 宽度 / 色条由区域负责。
 * 正文是 Markdown：先 renderMarkdown 出 HTML 片段，再交给白名单解析器变节点，
 * 组件层不出现 innerHTML。
 */

import { createDom } from '../dom.js';
import { createRichText } from '../rich-text.js';
import { renderMarkdown } from '../../../../shared/markdown.mjs';
import { EVENTS } from '../../contracts/events.js';

export function createArtifactView({ document }) {
  const { el } = createDom(document);
  const rich = createRichText({ document });

  return function artifactView(initialProps, ctx) {
    let props = initialProps || {};

    const name = el('span', { className: 'ap-name' });
    const close = el('button', {
      className: 'ap-close',
      attrs: { type: 'button' },
      text: '✕',
    });
    const content = el('div', { className: 'ap-content' });
    const scroll = el('div', { className: 'ap-scroll' }, [content]);
    const root = el('div', {
      className: 'artifact-view',
      style: { display: 'contents' },
    }, [el('div', { className: 'ap-head' }, [name, close]), scroll]);

    close.addEventListener('click', () => {
      ctx?.requestFocus?.();
      ctx?.emit({ type: EVENTS.ARTIFACT_CLOSE_CLICKED });
    });

    let contentKey = null;
    let lastPath = null;

    function setText(text) {
      if (contentKey === `text:${text}`) return;
      contentKey = `text:${text}`;
      content.textContent = text;
    }

    function setMarkdown(source) {
      const key = `md:${source}`;
      if (contentKey === key) return;
      contentKey = key;
      content.replaceChildren(...rich.toNodes(renderMarkdown(source)));
    }

    function update(next) {
      props = next || {};
      const label = props.name || '';
      if (name.textContent !== label) name.textContent = label;
      if (name.title !== label) name.title = label;
      close.setAttribute('aria-label', props.closeLabel || '关闭');

      if (props.status === 'loading') {
        setText(props.loadingText || '加载中…');
      } else if (props.status === 'error') {
        setText(props.error || props.failedText || '读取失败');
      } else if (props.status === 'success' && props.previewable === false) {
        setText(props.unsupportedText || '这个文件类型不支持预览');
      } else if (props.status === 'success') {
        setMarkdown(typeof props.content === 'string' ? props.content : '');
      } else {
        setText('');
      }

      if (props.path !== lastPath) {
        lastPath = props.path;
        scroll.scrollTop = 0;
      }
    }

    update(props);

    return {
      el: root,
      update,
      destroy() {
        root.remove?.();
      },
    };
  };
}
