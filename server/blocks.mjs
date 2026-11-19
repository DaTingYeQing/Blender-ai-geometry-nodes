/**
 * 块组装清单
 *
 * 唯一允许 import 各块 block.mjs 的地方。
 * 这里只写“谁被加载”，不写实现；依赖关系在各自的 block.mjs 里声明。
 */
import agentsBlock from "../modules/agents/block.mjs";
import artifactsBlock from "../modules/artifacts/block.mjs";
import flowBlock from "../modules/flow/block.mjs";
import piBlock from "../modules/pi/block.mjs";
import runtimeBlock from "../modules/runtime/block.mjs";
import registryBlock from "./registry/block.mjs";
import singleBlock from "./single/block.mjs";
import storeBlock from "./store/block.mjs";
import toolsBlock from "./tools/block.mjs";

export const blocks = [
  storeBlock,
  registryBlock,
  toolsBlock,
  agentsBlock,
  artifactsBlock,
  flowBlock,
  piBlock,
  runtimeBlock,
  singleBlock,
];
