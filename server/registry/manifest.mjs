import fsp from "node:fs/promises";
import { validateManifest } from "../../shared/agents-manifest.mjs";

export { validateManifest };

/**
 * 读 agents.json 并做结构校验。
 *
 * 规则在 shared/agents-manifest.mjs，和 shard/sync.mjs 是同一份：
 * 未知 profile / 工具名、字段类型不对、根不是对象都会在启动时直接报错。
 */
export async function loadManifest(file) {
  let raw;
  try {
    const text = await fsp.readFile(file, "utf8");
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`读不到 Agent 清单 ${file}：${error?.message || error}`);
  }

  return validateManifest(raw, { file });
}
