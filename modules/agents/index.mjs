export async function createServer(context) {
  const { createAgentsServer } = await import("./server/index.mjs");
  return createAgentsServer(context);
}

export async function mount(context) {
  const { mountAgents } = await import("./web/index.mjs");
  return mountAgents(context);
}
