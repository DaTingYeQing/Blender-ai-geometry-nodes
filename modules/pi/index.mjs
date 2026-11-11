export async function createServer(context) {
  const { createPiServer } = await import("./server/index.mjs");
  return createPiServer(context);
}
