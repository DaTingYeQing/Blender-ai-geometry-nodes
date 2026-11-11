export async function createServer(context) {
  const { createFlowServer } = await import("./server/index.mjs");
  return createFlowServer(context);
}

export async function mount(context) {
  const { mountFlow } = await import("./web/index.mjs");
  return mountFlow(context);
}
