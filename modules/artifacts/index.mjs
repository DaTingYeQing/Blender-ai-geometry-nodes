export async function createServer(context) {
  const { createArtifactsServer } = await import("./server/index.mjs");
  return createArtifactsServer(context);
}

export async function mount(context) {
  const { mountArtifacts } = await import("./web/index.mjs");
  return mountArtifacts(context);
}
