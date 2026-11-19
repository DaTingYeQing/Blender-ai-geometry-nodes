/**
 * pi 的启动参数只在这里拼一次。
 * RPC 模式（--mode rpc）和单人模式（无 --mode）共用，避免两套 flag 漂移。
 */
export function buildPiFlags({ mode = "rpc", sessionId, noExtensions, extensions } = {}) {
  const args = [];
  if (mode) args.push("--mode", mode);
  args.push("--approve");
  if (noExtensions) args.push("--no-extensions");
  for (const extension of extensions ?? []) args.push("--extension", String(extension));
  if (sessionId) args.push("--session-id", String(sessionId));
  return args;
}
