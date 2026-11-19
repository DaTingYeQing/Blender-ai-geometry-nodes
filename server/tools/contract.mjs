/**
 * 第一层（工具层）与第二层（编排层）之间的契约。
 *
 * 编排层只知道「拿这个项目路径换一个启动规格」，不知道扩展文件、
 * profile、settings.json 长什么样。换工具时只改 adapter 或 shard/agents.json。
 */

export const TOOL_CONTRACT_VERSION = 1;

export const TOOL_METHODS = Object.freeze({
  resolve: "resolve(projectPath) -> { noExtensions: boolean, extensions: string[] }",
  catalog: "catalog() -> { tools: Record<string, string>, profiles: Record<string, string[]> }",
});

/** 网关只暴露这两个方法；adapter 必须提供同名实现。 */
export function assertToolGateway(gateway) {
  if (!gateway || typeof gateway.resolve !== "function") {
    throw new Error("工具网关缺少 resolve(projectPath)");
  }
  if (typeof gateway.catalog !== "function") {
    throw new Error("工具网关缺少 catalog()");
  }
  return gateway;
}
