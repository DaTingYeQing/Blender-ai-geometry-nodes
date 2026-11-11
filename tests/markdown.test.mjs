import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "../app/js/core/markdown.mjs";

test("Markdown 渲染表格：对齐、转义竖线和行内代码", () => {
  const html = renderMarkdown(
    [
      "| 名称 | 数量 | 备注 |",
      "| :--- | ---: | :---: |",
      "| a | 12 | `x|y` |",
      "| b\\|c | 3 | 普通 |",
    ].join("\n"),
  );

  assert.match(html, /<div class="md-table"><table>/);
  assert.match(html, /<th class="al-l">名称<\/th>/);
  assert.match(html, /<th class="al-r">数量<\/th>/);
  assert.match(html, /<th class="al-c">备注<\/th>/);
  assert.match(html, /<td class="al-c"><code>x\|y<\/code><\/td>/);
  assert.match(html, /<td class="al-l">b\|c<\/td>/);
});

test("列数不齐时按表头补齐，普通段落里的竖线不当作表格", () => {
  const short = renderMarkdown(["| a | b | c |", "| --- | --- | --- |", "| 1 | 2 |"].join("\n"));
  assert.match(short, /<td>1<\/td><td>2<\/td><td><\/td>/);

  const paragraph = renderMarkdown("a | b\n第二行");
  assert.doesNotMatch(paragraph, /md-table/);
  assert.match(paragraph, /<p>a \| b 第二行<\/p>/);
});
