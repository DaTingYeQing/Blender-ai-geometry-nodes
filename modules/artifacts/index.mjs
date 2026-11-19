export async function createServer(context) {
  const { createArtifactsServer } = await import("./server/index.mjs");
  return createArtifactsServer(context);
}
