import { esc } from "./dom.mjs";

function inline(text) {
  const codes = [];
  let out = text.replace(/`([^`\n]+)`/g, (_, code) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });

  out = out
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");

  return out.replace(/\u0000(\d+)\u0000/g, (_, index) => codes[Number(index)]);
}

/** 按未转义、且不在行内代码里的 `|` 拆单元格。 */
function splitTableRow(line) {
  let text = String(line).trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);

  const cells = [];
  let cell = "";
  let inCode = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\" && text[index + 1] === "|") {
      cell += "|";
      index += 1;
      continue;
    }
    if (char === "`") {
      inCode = !inCode;
      cell += char;
      continue;
    }
    if (char === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function parseTableDelimiter(line) {
  const cells = splitTableRow(line);
  if (!cells.length) return null;
  const aligns = [];
  for (const cell of cells) {
    if (!/^:?-+:?$/.test(cell)) return null;
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    aligns.push(left && right ? "c" : right ? "r" : left ? "l" : "");
  }
  return aligns;
}

function renderTable(header, aligns, rows) {
  const alignClass = (index) => (aligns[index] ? ` class="al-${aligns[index]}"` : "");
  const head = header.map((cell, index) => `<th${alignClass(index)}>${inline(cell)}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${header
          .map((_, index) => `<td${alignClass(index)}>${inline(row[index] ?? "")}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<div class="md-table"><table><thead><tr>${head}</tr></thead>${
    body ? `<tbody>${body}</tbody>` : ""
  }</table></div>`;
}

/** 极简 Markdown 渲染：先转义再解析，不支持内嵌 HTML。 */
export function renderMarkdown(source) {
  const lines = esc(String(source ?? "").replace(/\r\n?/g, "\n")).split("\n");
  const html = [];
  let paragraph = [];
  let quote = [];
  let list = null;
  let fence = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    html.push(`<blockquote>${inline(quote.join(" "))}</blockquote>`);
    quote = [];
  };
  const flushList = () => {
    if (!list) return;
    html.push(`</${list}>`);
    list = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushQuote();
    flushList();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      if (line.trim().startsWith("```")) {
        html.push(`<pre><code>${fence.join("\n")}</code></pre>`);
        fence = null;
      } else {
        fence.push(line);
      }
      continue;
    }

    const trimmed = line.trim();
    if (/^```(\w*)\s*$/.test(trimmed)) {
      flushAll();
      fence = [];
      continue;
    }
    if (!trimmed) {
      flushAll();
      continue;
    }

    const aligns = index + 1 < lines.length ? parseTableDelimiter(lines[index + 1].trim()) : null;
    if (aligns && trimmed.includes("|")) {
      flushAll();
      const header = splitTableRow(trimmed);
      const rows = [];
      index += 2;
      while (index < lines.length) {
        const rowLine = lines[index].trim();
        if (!rowLine || !rowLine.includes("|")) break;
        if (/^(#{1,6}\s|>\s?|```|[-*+]\s|\d+[.)]\s)/.test(rowLine)) break;
        rows.push(splitTableRow(rowLine));
        index += 1;
      }
      index -= 1;
      html.push(renderTable(header, aligns, rows));
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushAll();
      html.push("<hr />");
      continue;
    }

    const quoted = trimmed.match(/^>\s?(.*)$/);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.*)$/);
    if (unordered) {
      flushParagraph();
      flushQuote();
      if (list !== "ul") {
        flushList();
        html.push("<ul>");
        list = "ul";
      }
      html.push(`<li>${inline(unordered[1])}</li>`);
      continue;
    }

    const ordered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      flushQuote();
      if (list !== "ol") {
        flushList();
        html.push("<ol>");
        list = "ol";
      }
      html.push(`<li>${inline(ordered[1])}</li>`);
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(trimmed);
  }

  if (fence) html.push(`<pre><code>${fence.join("\n")}</code></pre>`);
  flushAll();
  return html.join("\n");
}
