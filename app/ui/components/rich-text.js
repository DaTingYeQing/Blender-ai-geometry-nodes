/* ===== 受限富文本 → DOM =====
 * 会话正文在两种来源里都是 HTML 片段：后端预渲染的 `entry.html`，
 * 以及 `shared/markdown.mjs` 的 `renderMarkdown()` 输出。
 * 组件层不许用 `innerHTML`，所以这里按“只认白名单标签”的方式手写一个
 * 极小的解析器，把片段变成真正的节点。
 *
 * 安全约定（源文本本身已被 `renderMarkdown` 转义，这里再兜一层）：
 *   - 只创建白名单里的标签；不认识的标签整段当文本，不会变成元素；
 *   - 只复制 `href`（仅 http/https）与安全字符的 `class`，其余属性一律丢弃；
 *   - 链接强制 `target="_blank" rel="noreferrer"`；
 *   - 注释、`<!doctype>`、处理指令直接丢掉。
 */

const TAGS = new Set([
  'p', 'br', 'hr', 'strong', 'em', 'del', 'code', 'pre', 'a',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'div', 'span',
]);

const VOID = new Set(['br', 'hr']);
const SAFE_CLASS = /^[a-zA-Z0-9 _-]+$/;
const SAFE_HREF = /^https?:\/\//i;

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  '#39': "'",
};

function decode(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(ENTITIES, name)) return ENTITIES[name];
    if (name[0] === '#') {
      const hex = name[1] === 'x' || name[1] === 'X';
      const code = Number.parseInt(hex ? name.slice(2) : name.slice(1), hex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
    }
    return match;
  });
}

/**
 * @param {{ document: Document }} deps
 */
export function createRichText({ document }) {
  if (!document) throw new Error('createRichText: 需要 document');

  function applyAttributes(node, tag, source) {
    if (tag === 'a') {
      const href = source.match(/\bhref="([^"]*)"/i);
      if (href && SAFE_HREF.test(decode(href[1]).trim())) {
        node.setAttribute('href', decode(href[1]).trim());
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noreferrer');
      }
    }
    const className = source.match(/\bclass="([^"]*)"/i);
    if (className && SAFE_CLASS.test(className[1])) {
      node.setAttribute('class', className[1]);
    }
  }

  /**
   * 把一段受限 HTML 变成节点数组。顶层节点由调用方自己挂到目标容器上。
   * @param {string} html
   * @returns {Node[]}
   */
  function toNodes(html) {
    const source = String(html ?? '');
    const root = document.createElement('div');
    const stack = [root];

    const current = () => stack[stack.length - 1];
    const text = (value) => {
      if (!value) return;
      current().appendChild(document.createTextNode(decode(value)));
    };

    let index = 0;
    while (index < source.length) {
      const open = source.indexOf('<', index);
      if (open < 0) {
        text(source.slice(index));
        break;
      }
      if (open > index) text(source.slice(index, open));

      const close = source.indexOf('>', open);
      if (close < 0) {
        text(source.slice(open));
        break;
      }

      const raw = source.slice(open + 1, close);
      index = close + 1;

      if (!raw || raw[0] === '!' || raw[0] === '?') continue;

      const closing = raw[0] === '/';
      const body = closing ? raw.slice(1).trim() : raw;
      const name = body.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
      if (!name) {
        text(source.slice(open, close + 1));
        continue;
      }

      const tag = name[1].toLowerCase();
      if (!TAGS.has(tag)) {
        text(source.slice(open, close + 1));
        continue;
      }

      if (closing) {
        for (let depth = stack.length - 1; depth > 0; depth -= 1) {
          if (stack[depth].tagName.toLowerCase() === tag) {
            stack.length = depth;
            break;
          }
        }
        continue;
      }

      const node = document.createElement(tag);
      applyAttributes(node, tag, body);
      current().appendChild(node);
      if (!VOID.has(tag) && !raw.trimEnd().endsWith('/')) stack.push(node);
    }

    return [...root.childNodes];
  }

  return { toNodes };
}
