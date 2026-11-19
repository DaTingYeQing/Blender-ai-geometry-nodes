export async function createServer(context) {
  const { createRuntimeServer } = await import("./server/index.mjs");
  return createRuntimeServer(context);
}
