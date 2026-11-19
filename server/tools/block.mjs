import { assertToolGateway } from "./contract.mjs";
import { createToolGateway } from "./index.mjs";

export default {
  id: "tools",
  version: 1,

  provides: {
    resolve: "function",
    catalog: "function",
  },

  requires: {},

  create({ context }) {
    const gateway = context.tools || createToolGateway();
    return { api: assertToolGateway(gateway) };
  },
};
