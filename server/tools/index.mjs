import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_CONTRACT_VERSION, assertToolGateway } from "./contract.mjs";
import { createPiExtensionsAdapter } from "./adapters/pi-extensions.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function defaultShardDir() {
  return process.env.PI_FLOW_HOME || path.join(ROOT_DIR, "shard");
}

/** 第二层唯一的工具入口；内部换成 CLI / RPC 都只动 adapter。 */
export function createToolGateway({ shardDir = defaultShardDir(), adapter } = {}) {
  const impl = adapter || createPiExtensionsAdapter({ shardDir });

  return assertToolGateway({
    version: TOOL_CONTRACT_VERSION,
    resolve: (projectPath) => impl.resolve(projectPath),
    catalog: () => impl.catalog(),
    readAgentConfig: (projectPath) => impl.readAgentConfig(projectPath),
    writeAgentConfig: (projectPath, config) => impl.writeAgentConfig(projectPath, config),
  });
}
