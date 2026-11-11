export async function createServer(context) {
  const { createRuntimeServer } = await import("./server/index.mjs");
  return createRuntimeServer(context);
}

export async function mount(context) {
  const { mountRuntime } = await import("./web/index.mjs");
  return mountRuntime(context);
}
