export async function createServer(context) {
  const { createAgentsServer } = await import("./server/index.mjs");
  return createAgentsServer(context);
}
