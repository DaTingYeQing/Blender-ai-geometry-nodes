import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2] || "release/win-unpacked");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`已删除 ${dir}`);
    process.exit(0);
  } catch {
    if (attempt < 5) await wait(1000);
  }
}

// 编辑器/杀毒软件可能短暂占用 asar；安装包已经生成，清理失败不应让构建整体失败。
console.warn(`未能删除 ${dir}（被其他程序占用），可稍后手动删除。`);
