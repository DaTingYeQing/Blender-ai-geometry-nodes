export const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);

function clip(text, limit) {
  const value = String(text ?? "");
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

export function summarizeToolArgs(toolName, args) {
  if (!args || typeof args !== "object") return "";
  let text = "";
  if (toolName === "bash" || toolName === "powershell") text = String(args.command || "");
  else if (args.path) text = String(args.path);
  else if (args.file_path) text = String(args.file_path);
  else text = JSON.stringify(args);
  return clip(text.replace(/\s+/g, " ").trim(), 160);
}

/** message_end.message 是权威版本；message_update 只是增量。 */
export function assistantText(message) {
  if (!message || message.role !== "assistant") return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}
